using System.Net.Http;

namespace Browser.Core;

/// <summary>Téléchargement mené hors du moteur web, piloté par l'encart comme ceux du moteur.</summary>
public interface IBackgroundDownload
{
    event Action? Changed;
    string State { get; }
    string Phase { get; }
    long BytesReceived { get; }
    long TotalBytesToReceive { get; }
    string ResultFilePath { get; }
    bool Paused { get; }
    bool Canceled { get; }
    bool CanResume { get; }
    /// <summary>Adresse à rouvrir pour « Réessayer » ; null quand la relance n'a pas de sens.</summary>
    string? RetryUrl { get; }
    void Start();
    void Pause();
    void Resume();
    void Cancel();
}

/// <summary>
/// Un fichier quelconque téléchargé à plusieurs connexions (voir <see cref="SegmentedTransfer"/>), avec la session du
/// site (cookies, référent, agent). Écrit d'abord « .part », puis prend le nom choisi une fois complet.
/// </summary>
public sealed class FileDownload(string url, string resultPath, string? referer, string userAgent, IReadOnlyList<VideoCookie> cookies) : IBackgroundDownload
{
    private readonly object _gate = new();
    private readonly string _url = url;
    private readonly string _targetPath = resultPath;
    private readonly string? _referer = referer;
    private readonly string _userAgent = userAgent;
    private readonly IReadOnlyList<VideoCookie> _cookies = cookies;
    private CancellationTokenSource? _cancel;
    private Task? _running;
    private bool _resuming;

    public event Action? Changed;
    public string State { get; private set; } = "InProgress";
    public string Phase { get; private set; } = "parallel:0";
    public long BytesReceived { get; private set; }
    public long TotalBytesToReceive { get; private set; }
    public string ResultFilePath { get; private set; } = resultPath;
    public bool Paused { get; private set; }
    public bool Canceled { get; private set; }
    public bool CanResume => State == "Interrupted" && !Canceled && (Paused || File.Exists(SegmentedTransfer.PlanPath(Part)));
    public string? RetryUrl => _url;
    private string Part => _targetPath + ".part";

    public void Start()
    {
        lock (_gate)
        {
            if (_running is not null || Canceled) return;
            _running = Task.Run(RunAsync);
        }
    }

    public void Pause()
    {
        CancellationTokenSource? cancel;
        lock (_gate)
        {
            if (State != "InProgress" || Canceled) return;
            Paused = true;
            cancel = _cancel;
        }
        try { cancel?.Cancel(); } catch (ObjectDisposedException) { }
    }

    public void Cancel()
    {
        CancellationTokenSource? cancel;
        bool removeNow;
        lock (_gate)
        {
            if (State == "Completed" || Canceled) return;
            Canceled = true;
            Paused = false;
            State = "Interrupted";
            Phase = "canceled";
            cancel = _cancel;
            removeNow = _running is null || _running.IsCompleted;
        }
        try { cancel?.Cancel(); } catch (ObjectDisposedException) { }
        if (removeNow) RemovePartial();
        Changed?.Invoke();
    }

    public async void Resume()
    {
        Task? previous;
        lock (_gate)
        {
            if (!CanResume || _resuming) return;
            _resuming = true;
            previous = _running;
        }
        try
        {
            if (previous is not null) await previous.ConfigureAwait(false);
            lock (_gate)
            {
                if (Canceled || State != "Interrupted") return;
                Paused = false;
                State = "InProgress";
                _running = Task.Run(RunAsync);
            }
        }
        catch
        {
            // RunAsync capture déjà ses exceptions ; ne jamais laisser échapper une erreur d'une méthode async void.
        }
        finally
        {
            lock (_gate) _resuming = false;
        }
    }

    private async Task RunAsync()
    {
        using var cancellation = new CancellationTokenSource();
        lock (_gate)
        {
            _cancel = cancellation;
            if (Canceled || Paused) cancellation.Cancel();
        }
        using var http = SegmentedTransfer.Client(VideoCookie.Container(_cookies));
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_targetPath)!);
            Phase = "parallel:0"; Changed?.Invoke();
            await SegmentedTransfer.RunAsync(http, Request, Part, (bytes, total) => { BytesReceived = bytes; TotalBytesToReceive = total; Changed?.Invoke(); },
                cancellation.Token, connections: n => { Phase = "parallel:" + n; Changed?.Invoke(); });
            lock (_gate) if (Canceled || Paused) throw new OperationCanceledException();
            var finalPath = MoveToAvailable(_targetPath);
            MarkOfTheWeb.Apply(finalPath);
            var length = new FileInfo(finalPath).Length;
            var removeMoved = false;
            lock (_gate)
            {
                if (Canceled) { removeMoved = true; State = "Interrupted"; Phase = "canceled"; }
                else { ResultFilePath = finalPath; Paused = false; BytesReceived = TotalBytesToReceive = length; State = "Completed"; Phase = "done"; }
            }
            if (removeMoved) try { File.Delete(finalPath); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
        catch (OperationCanceledException)
        {
            lock (_gate) if (State != "Completed") { State = "Interrupted"; Phase = Canceled ? "canceled" : Paused ? "paused" : "failed"; }
        }
        catch (Exception)
        {
            lock (_gate) if (State != "Completed") { Paused = false; State = "Interrupted"; Phase = Canceled ? "canceled" : "failed"; }
        }
        finally
        {
            bool cleanup;
            lock (_gate) { _cancel = null; cleanup = Canceled; }
            if (cleanup) RemovePartial();
            Changed?.Invoke();
        }
    }

    private HttpRequestMessage Request()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, _url);
        if (Uri.TryCreate(_referer, UriKind.Absolute, out var from) && from.Scheme is "http" or "https") request.Headers.Referrer = from;
        if (_userAgent.Length > 0) request.Headers.TryAddWithoutValidation("User-Agent", _userAgent);
        return request;
    }

    private string MoveToAvailable(string path)
    {
        for (var attempt = 0; ; attempt++)
        {
            var candidate = Available(path);
            try { File.Move(Part, candidate); return candidate; }
            catch (IOException) when (attempt < 20 && File.Exists(candidate)) { }
        }
    }

    // Le moteur a réservé ce nom, mais un fichier du même nom a pu apparaître depuis.
    private static string Available(string path)
    {
        if (!File.Exists(path)) return path;
        var (folder, stem, extension) = (Path.GetDirectoryName(path)!, Path.GetFileNameWithoutExtension(path), Path.GetExtension(path));
        for (var n = 2; ; n++) { var candidate = Path.Combine(folder, $"{stem} ({n}){extension}"); if (!File.Exists(candidate)) return candidate; }
    }

    private void RemovePartial()
    {
        foreach (var file in new[] { Part, SegmentedTransfer.PlanPath(Part) })
            try { File.Delete(file); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }
}
