using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using Microsoft.Win32.SafeHandles;

namespace Browser.Core;

public sealed record TransferResult(long Bytes, string MediaType, bool Parallel);

/// <summary>
/// Téléchargement à plusieurs connexions, comme IDM : le fichier est découpé en plages demandées en parallèle, chacune sur
/// sa propre connexion HTTP/1.1, et écrites directement à leur place. Beaucoup de serveurs limitent le débit par
/// connexion : huit connexions en obtiennent jusqu'à huit fois plus. Une pause garde le plan à côté du fichier
/// (« .sol-plan ») pour reprendre là où chaque plage s'était arrêtée. Un serveur qui refuse les plages, ou un fichier de
/// moins de 4 Mo, passe par une seule connexion.
/// </summary>
public static class SegmentedTransfer
{
    public const int Connections = 8;
    public const long MinSplit = 4L << 20;
    private const long MinSteal = 1L << 20;
    private const int Buffer = 256 << 10;

    /// <summary>Client sans décompression (les plages portent sur les octets bruts) et sans HTTP/2 (une connexion par plage).</summary>
    public static HttpClient Client(CookieContainer? cookies = null) => new(new SocketsHttpHandler
    {
        CookieContainer = cookies ?? new CookieContainer(), UseCookies = true, AutomaticDecompression = DecompressionMethods.None,
        MaxConnectionsPerServer = Connections + 2, PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30), ConnectTimeout = TimeSpan.FromSeconds(20),
    }) { Timeout = Timeout.InfiniteTimeSpan };

    public static string PlanPath(string path) => path + ".sol-plan";

    /// <summary>Le serveur découpe-t-il ce fichier, de cette taille, en plages ? Une requête d'un seul octet.</summary>
    public static async Task<bool> AcceptsRangesAsync(HttpClient http, HttpRequestMessage request, long expectedTotal, CancellationToken ct)
    {
        request.Headers.Range = new RangeHeaderValue(0, 0);
        try
        {
            using var response = await SendAsync(http, request, ct);
            return response.StatusCode == HttpStatusCode.PartialContent && response.Content.Headers.ContentRange is { From: 0, Length: { } length }
                && length == expectedTotal && length >= MinSplit;
        }
        catch (Exception e) when (e is HttpRequestException or IOException or TaskCanceledException) { return false; }
    }

    /// <param name="request">Nouvelle requête GET vers le fichier, avec ses en-têtes (référent, agent).</param>
    /// <param name="accept">Refuse un type de contenu inattendu (une page d'erreur au lieu d'une vidéo, par exemple).</param>
    /// <param name="connections">Rapporte le nombre de connexions actives.</param>
    public static async Task<TransferResult> RunAsync(HttpClient http, Func<HttpRequestMessage> request, string path, Action<long, long> progress,
        CancellationToken ct, Func<string, bool>? accept = null, Action<int>? connections = null, int parts = Connections)
    {
        var saved = File.Exists(path) && File.Exists(PlanPath(path)) ? SegmentPlan.FromJson(await File.ReadAllTextAsync(PlanPath(path), ct)) : null;
        if (saved is not null && new FileInfo(path).Length != saved.Total) saved = null;
        try { return await RunOnceAsync(http, request, path, progress, ct, accept, connections, parts, saved); }
        catch (InvalidDataException) when (saved is not null)
        {
            // Le fichier a changé sur le serveur depuis la pause : on repart de zéro.
            File.Delete(path); File.Delete(PlanPath(path));
            return await RunOnceAsync(http, request, path, progress, ct, accept, connections, parts, null);
        }
    }

    private static async Task<TransferResult> RunOnceAsync(HttpClient http, Func<HttpRequestMessage> request, string path, Action<long, long> progress,
        CancellationToken ct, Func<string, bool>? accept, Action<int>? connections, int parts, SegmentPlan? plan)
    {
        HttpResponseMessage? first = null;
        var mediaType = "";
        if (plan is null)
        {
            var probe = request();
            probe.Headers.Range = new RangeHeaderValue(0, null);
            first = await SendAsync(http, probe, ct);
            mediaType = first.Content.Headers.ContentType?.MediaType ?? "";
            if (accept is not null && !accept(mediaType)) { first.Dispose(); throw new IOException("Unexpected content"); }
            var total = first.Content.Headers.ContentRange?.Length ?? 0;
            if (first.StatusCode != HttpStatusCode.PartialContent || first.Content.Headers.ContentRange?.From != 0 || total < MinSplit)
                return await SingleAsync(first, path, progress, mediaType, ct);
            plan = SegmentPlan.Split(total, parts, Validator(first));
            File.Delete(PlanPath(path));
            await using (var create = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read)) create.SetLength(total);
        }

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var received = plan.Done; var active = 0;
        var clock = Stopwatch.StartNew(); var gate = new object();
        void Report(bool force)
        {
            lock (gate) { if (!force && clock.ElapsedMilliseconds < 120) return; clock.Restart(); }
            progress(Interlocked.Read(ref received), plan.Total);
        }
        using var handle = File.OpenHandle(path, FileMode.Open, FileAccess.Write, FileShare.Read, FileOptions.Asynchronous);
        Report(true);

        async Task Worker(Segment? segment, HttpResponseMessage? response)
        {
            connections?.Invoke(Interlocked.Increment(ref active));
            try
            {
                while (segment is not null)
                {
                    await FetchAsync(http, request, plan, segment, response, handle, n => { Interlocked.Add(ref received, n); Report(false); }, linked.Token);
                    response = null;
                    lock (plan) { segment.Taken = false; segment = plan.Next(MinSteal); }
                }
            }
            catch { linked.Cancel(); throw; }
            finally { connections?.Invoke(Interlocked.Decrement(ref active)); }
        }

        var initial = new List<Segment>();
        lock (plan)
        {
            foreach (var s in plan.Segments) s.Taken = false;
            for (var i = 0; i < parts && plan.Next(MinSteal) is { } segment; i++) initial.Add(segment);
        }
        // Lancées hors du verrou : une connexion rapide ne doit pas tenir le plan pendant que les autres démarrent.
        // La réponse de la sonde (plage 0-) sert la première plage : aucune requête perdue.
        var workers = initial.Select((segment, i) => Worker(segment, i == 0 && segment.Start == 0 ? first : null)).ToList();
        if (first is not null && workers.Count == 0) first.Dispose();
        try { await Task.WhenAll(workers); }
        catch
        {
            await Task.WhenAll(workers.Select(w => w.ContinueWith(_ => { }, TaskScheduler.Default)));
            first?.Dispose();
            if (ct.IsCancellationRequested && plan.Validator is not null)
                lock (plan) File.WriteAllText(PlanPath(path), plan.ToJson()); // pause : chaque plage reprendra où elle en était
            else if (!ct.IsCancellationRequested) File.Delete(PlanPath(path));
            ct.ThrowIfCancellationRequested();
            // Les autres connexions ont été annulées par la première en échec : c'est son erreur qui compte.
            var cause = workers.Where(w => w.IsFaulted).SelectMany(w => w.Exception!.InnerExceptions).FirstOrDefault(e => e is not OperationCanceledException);
            if (cause is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Throw(cause);
            throw;
        }
        File.Delete(PlanPath(path));
        Report(true);
        return new TransferResult(plan.Total, mediaType, true);
    }

    private static async Task FetchAsync(HttpClient http, Func<HttpRequestMessage> request, SegmentPlan plan, Segment segment, HttpResponseMessage? response,
        SafeFileHandle handle, Action<long> wrote, CancellationToken ct)
    {
        var buffer = new byte[Buffer];
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                if (response is null)
                {
                    long from, to;
                    lock (plan) { from = segment.Position; to = segment.End; }
                    if (from > to) return;
                    var next = request();
                    next.Headers.Range = new RangeHeaderValue(from, to);
                    if (plan.Validator is { } validator) next.Headers.TryAddWithoutValidation("If-Range", validator);
                    response = await SendAsync(http, next, ct);
                    if (response.StatusCode != HttpStatusCode.PartialContent || response.Content.Headers.ContentRange?.From != from)
                        throw new InvalidDataException("Range refused or file changed");
                }
                using (response)
                {
                    await using var input = await response.Content.ReadAsStreamAsync(ct);
                    while (true)
                    {
                        var read = await input.ReadAsync(buffer, ct);
                        if (read == 0) break;
                        (long Offset, int Count) slot;
                        lock (plan) slot = SegmentPlan.Reserve(segment, read);
                        if (slot.Count > 0) { await RandomAccess.WriteAsync(handle, buffer.AsMemory(0, slot.Count), slot.Offset, ct); wrote(slot.Count); }
                        if (slot.Count < read) return; // la fin de la plage a été donnée à une autre connexion
                    }
                }
                response = null;
                lock (plan) if (segment.Remaining == 0) return;
                throw new IOException("Connection closed early");
            }
            catch (Exception e) when (e is HttpRequestException or IOException && e is not InvalidDataException && attempt < 5 && !ct.IsCancellationRequested)
            {
                response?.Dispose(); response = null;
                await Task.Delay(TimeSpan.FromMilliseconds(500 * attempt), ct);
            }
        }
    }

    private static async Task<TransferResult> SingleAsync(HttpResponseMessage response, string path, Action<long, long> progress, string mediaType, CancellationToken ct)
    {
        using (response)
        {
            var total = response.Content.Headers.ContentRange?.Length ?? response.Content.Headers.ContentLength ?? 0;
            await using var input = await response.Content.ReadAsStreamAsync(ct);
            await using var output = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read, Buffer, true);
            var buffer = new byte[Buffer]; long received = 0; var clock = Stopwatch.StartNew();
            progress(0, total);
            while (await input.ReadAsync(buffer, ct) is var read && read > 0)
            {
                await output.WriteAsync(buffer.AsMemory(0, read), ct); received += read;
                if (clock.ElapsedMilliseconds >= 120) { progress(received, total); clock.Restart(); }
            }
            if (total > 0 && received != total) throw new IOException("Truncated transfer");
            progress(received, total);
            return new TransferResult(received, mediaType, false);
        }
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient http, HttpRequestMessage request, CancellationToken ct)
    {
        // Octets bruts : une plage d'un contenu compressé n'aurait pas de sens.
        request.Headers.AcceptEncoding.Clear();
        request.Headers.TryAddWithoutValidation("Accept-Encoding", "identity");
        var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) { var status = response.StatusCode; response.Dispose(); throw new HttpRequestException($"HTTP {(int)status}", null, status); }
        return response;
    }

    private static string? Validator(HttpResponseMessage response) =>
        response.Headers.ETag is { IsWeak: false } etag ? etag.ToString()
        : response.Content.Headers.LastModified is { } modified ? modified.ToString("R") : null;
}
