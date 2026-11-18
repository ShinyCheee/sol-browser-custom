using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using Browser.Core;

public class SegmentedTransferTests
{
    [Fact]
    public void Plan_splits_steals_reserves_and_round_trips()
    {
        var plan = SegmentPlan.Split(100, 4, "\"v1\"");
        Assert.Equal([0L, 25, 50, 75], plan.Segments.Select(s => s.Start));
        Assert.Equal(99, plan.Segments[^1].End);
        var first = plan.Next(10)!;
        Assert.Same(plan.Segments[0], first);
        foreach (var _ in plan.Segments.Skip(1).ToArray()) plan.Next(10);
        // Toutes les plages sont prises : la suivante vient de la moitié de la plus grosse.
        Assert.Equal((0L, 10), SegmentPlan.Reserve(first, 10));
        var stolen = plan.Next(5)!;
        // Plus grosse plage restante : la deuxième (25 octets, la première à égalité), coupée en son milieu.
        Assert.Equal(37, stolen.Start); Assert.Equal(49, stolen.End);
        Assert.Equal(36, plan.Segments[1].End);
        Assert.Equal((10L, 15), SegmentPlan.Reserve(first, 1000));
        Assert.Equal(0, first.Remaining);
        Assert.Equal(25, plan.Done);
        var copy = SegmentPlan.FromJson(plan.ToJson())!;
        Assert.Equal(plan.Total, copy.Total); Assert.Equal("\"v1\"", copy.Validator);
        Assert.Equal(plan.Segments.Select(s => (s.Start, s.End, s.Position)), copy.Segments.Select(s => (s.Start, s.End, s.Position)));
        Assert.Null(SegmentPlan.FromJson("""{"Total":10,"Validator":null,"Ranges":[[0,20,0]]}"""));
        Assert.Null(SegmentPlan.FromJson("pas du json"));
    }

    [Fact]
    public async Task Large_file_arrives_identical_over_parallel_connections()
    {
        var data = Data(16 << 20);
        await using var server = new RangeServer(data) { MinConcurrency = 4 };
        var path = Temp();
        try
        {
            using var http = SegmentedTransfer.Client();
            var result = await SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, CancellationToken.None);
            Assert.True(result.Parallel);
            Assert.Equal(data, await File.ReadAllBytesAsync(path));
            Assert.True(server.MaxConcurrent >= 4, $"only {server.MaxConcurrent} concurrent connections");
            Assert.False(File.Exists(SegmentedTransfer.PlanPath(path)));
        }
        finally { Clean(path); }
    }

    [Fact]
    public async Task Servers_without_ranges_small_files_and_capped_probes_succeed_over_one_connection()
    {
        foreach (var (size, ranges, cap, expectedRequests) in new[] { (8 << 20, false, 0, 1), (1 << 20, true, 0, 1), (512 << 10, true, 4096, 2) })
        {
            var data = Data(size);
            await using var server = new RangeServer(data, ranges) { ProbeCap = cap };
            var path = Temp();
            try
            {
                using var http = SegmentedTransfer.Client();
                var result = await SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, CancellationToken.None);
                Assert.False(result.Parallel);
                Assert.Equal(data, await File.ReadAllBytesAsync(path));
                Assert.Equal(expectedRequests, server.Requests);
            }
            finally { Clean(path); }
        }
    }

    [Fact]
    public async Task Pause_writes_every_reserved_byte_without_zero_holes_resumes_and_restarts_if_changed()
    {
        var data = NonZeroData(16 << 20, seed: 3);
        await using var server = new RangeServer(data);
        var path = Temp();
        try
        {
            using var http = SegmentedTransfer.Client();
            using (var pause = new CancellationTokenSource())
            {
                server.ArmPause(4 << 20, pause.Cancel);
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                    SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, pause.Token));
            }
            await server.SettleAsync();
            Assert.True(File.Exists(SegmentedTransfer.PlanPath(path)));

            // Intégrité stricte : aucun trou de zéros dans les plages marquées reçues dans .sol-plan.
            var plan = SegmentPlan.FromJson(await File.ReadAllTextAsync(SegmentedTransfer.PlanPath(path)))!;
            var partial = await File.ReadAllBytesAsync(path);
            Assert.True(plan.Done > 0 && plan.Done < data.Length);
            foreach (var s in plan.Segments)
                for (var pos = s.Start; pos < s.Position; pos++)
                    Assert.Equal(data[pos], partial[pos]);

            var servedBeforeResume = server.BytesServed;
            await SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, CancellationToken.None);
            await server.SettleAsync();
            Assert.Equal(data, await File.ReadAllBytesAsync(path));
            Assert.True(server.BytesServed - servedBeforeResume < data.Length - (2 << 20), "resume downloaded the finished ranges again");

            // Nouveau contenu sur le serveur entre la pause et la reprise : repart de zéro sans mélange.
            var changed = NonZeroData(16 << 20, seed: 7);
            using (var pause = new CancellationTokenSource())
            {
                server.ArmPause(server.BytesServed + (3 << 20), pause.Cancel);
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                    SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, pause.Token));
            }
            await server.SettleAsync();
            server.Replace(changed);
            await SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, CancellationToken.None);
            Assert.Equal(changed, await File.ReadAllBytesAsync(path));
        }
        finally { Clean(path); }
    }

    [Fact]
    public async Task Rejects_secondary_range_when_server_changes_content_range_total_length()
    {
        var data = Data(8 << 20);
        await using var server = new RangeServer(data) { SecondaryReportedLength = (8 << 20) + 1024 };
        var path = Temp();
        try
        {
            using var http = SegmentedTransfer.Client();
            await Assert.ThrowsAsync<InvalidDataException>(() =>
                SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, CancellationToken.None));
            Assert.False(File.Exists(SegmentedTransfer.PlanPath(path)));
        }
        finally { Clean(path); }
    }

    internal static byte[] Data(int size, int seed = 1) { var bytes = new byte[size]; new Random(seed).NextBytes(bytes); return bytes; }
    internal static byte[] NonZeroData(int size, int seed = 1)
    {
        var bytes = Data(size, seed);
        for (var i = 0; i < bytes.Length; i++) if (bytes[i] == 0) bytes[i] = 1;
        return bytes;
    }
    private static string Temp() => Path.Combine(Path.GetTempPath(), "sol-segmented-" + Guid.NewGuid().ToString("N") + ".part");
    private static void Clean(string path) { File.Delete(path); File.Delete(SegmentedTransfer.PlanPath(path)); }
}

/// <summary>Serveur HTTP déterministe : plages, ETag, If-Range, barrière de concurrence et pause pilotée sans course.</summary>
internal sealed class RangeServer : IAsyncDisposable
{
    private readonly HttpListener _listener;
    private readonly bool _ranges;
    private readonly ConcurrentDictionary<int, Task> _inflight = new();
    private readonly TaskCompletionSource _concurrencyGate = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private byte[] _data;
    private string _etag = "\"a\"";
    private int _active, _seq;
    private long _pauseAt = long.MaxValue;
    private Action? _onPause;
    private TaskCompletionSource? _pauseHold;
    public int MaxConcurrent, Requests, MinConcurrency, ProbeCap, StatusCode;
    public long BytesServed, SecondaryReportedLength;
    public string Url { get; }

    public RangeServer(byte[] data, bool ranges = true)
    {
        (_data, _ranges) = (data, ranges);
        for (var attempt = 0; ; attempt++)
        {
            var port = FreePort();
            var listener = new HttpListener();
            listener.Prefixes.Add($"http://localhost:{port}/");
            try { listener.Start(); _listener = listener; Url = $"http://localhost:{port}/file.bin"; break; }
            catch (HttpListenerException) when (attempt < 15) { listener.Close(); }
        }
        _ = Task.Run(Loop);
    }

    public void Replace(byte[] data) { _data = data; _etag = "\"b\""; }
    public HttpRequestMessage Request() => new(HttpMethod.Get, Url);

    public void ArmPause(long bytesServedTarget, Action trigger)
    {
        _pauseHold = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _onPause = trigger;
        Volatile.Write(ref _pauseAt, bytesServedTarget);
    }

    public async Task SettleAsync()
    {
        Volatile.Write(ref _pauseAt, long.MaxValue);
        _pauseHold?.TrySetResult();
        var pending = _inflight.Values.ToArray();
        if (pending.Length > 0) await Task.WhenAll(pending).WaitAsync(TimeSpan.FromSeconds(5));
    }

    private async Task Loop()
    {
        while (_listener.IsListening)
        {
            HttpListenerContext context;
            try { context = await _listener.GetContextAsync(); } catch (Exception) { return; }
            var id = Interlocked.Increment(ref _seq);
            var task = Task.Run(() => Serve(context));
            _inflight[id] = task;
            _ = task.ContinueWith(_ => _inflight.TryRemove(KeyValuePair.Create(id, task)), TaskScheduler.Default);
        }
    }

    private async Task Serve(HttpListenerContext context)
    {
        Interlocked.Increment(ref Requests);
        var now = Interlocked.Increment(ref _active);
        lock (this) MaxConcurrent = Math.Max(MaxConcurrent, now);
        if (MinConcurrency > 0 && now >= MinConcurrency) _concurrencyGate.TrySetResult();
        var response = context.Response;
        try
        {
            if (StatusCode >= 400) { response.StatusCode = StatusCode; response.Close(); return; }
            var data = _data;
            long from = 0, to = data.Length - 1;
            var range = context.Request.Headers["Range"];
            var ifRange = context.Request.Headers["If-Range"];
            var partial = _ranges && range is not null && (ifRange is null || ifRange == _etag);
            if (partial)
            {
                var spec = range!["bytes=".Length..].Split('-');
                from = long.Parse(spec[0]);
                if (spec[1].Length > 0) to = Math.Min(long.Parse(spec[1]), data.Length - 1);
                else if (ProbeCap > 0) to = Math.Min(from + ProbeCap - 1, data.Length - 1);
                var reportedTotal = from > 0 && SecondaryReportedLength > 0 ? SecondaryReportedLength : data.Length;
                response.StatusCode = 206;
                response.Headers["Content-Range"] = $"bytes {from}-{to}/{reportedTotal}";
            }
            response.Headers["ETag"] = _etag;
            if (_ranges) response.Headers["Accept-Ranges"] = "bytes";
            response.ContentType = "application/octet-stream";
            response.ContentLength64 = to - from + 1;
            for (var offset = from; offset <= to; offset += 64 << 10)
            {
                if (MinConcurrency > 1 && offset > from)
                    await _concurrencyGate.Task.WaitAsync(TimeSpan.FromSeconds(2)).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
                var count = (int)Math.Min(64 << 10, to - offset + 1);
                await response.OutputStream.WriteAsync(data.AsMemory((int)offset, count));
                if (Interlocked.Add(ref BytesServed, count) >= Volatile.Read(ref _pauseAt))
                {
                    Interlocked.Exchange<Action?>(ref _onPause, null)?.Invoke();
                    if (_pauseHold is { } hold)
                        await hold.Task.WaitAsync(TimeSpan.FromSeconds(2)).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
                }
            }
            response.Close();
        }
        catch (Exception) { try { response.Abort(); } catch (Exception) { } }
        finally { Interlocked.Decrement(ref _active); }
    }

    private static int FreePort()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    public async ValueTask DisposeAsync()
    {
        _pauseHold?.TrySetResult();
        _concurrencyGate.TrySetResult();
        _listener.Stop();
        _listener.Close();
        await SettleAsync();
    }
}
