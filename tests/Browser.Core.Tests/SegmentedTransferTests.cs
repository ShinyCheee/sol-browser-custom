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
        var data = Data(24 << 20);
        await using var server = new RangeServer(data);
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
    public async Task Servers_without_ranges_and_small_files_use_one_connection()
    {
        foreach (var (size, ranges) in new[] { (12 << 20, false), (1 << 20, true) })
        {
            var data = Data(size);
            await using var server = new RangeServer(data, ranges);
            var path = Temp();
            try
            {
                using var http = SegmentedTransfer.Client();
                var result = await SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, CancellationToken.None);
                Assert.False(result.Parallel);
                Assert.Equal(data, await File.ReadAllBytesAsync(path));
                Assert.Equal(1, server.Requests);
            }
            finally { Clean(path); }
        }
    }

    [Fact]
    public async Task Pause_resumes_where_each_range_stopped_and_restarts_when_the_file_changed()
    {
        var data = Data(20 << 20);
        await using var server = new RangeServer(data) { Delay = 2 };
        var path = Temp();
        try
        {
            using var http = SegmentedTransfer.Client();
            using (var pause = new CancellationTokenSource())
            {
                var task = SegmentedTransfer.RunAsync(http, server.Request, path, (bytes, _) => { if (bytes > 6 << 20) pause.Cancel(); }, pause.Token);
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
            }
            Assert.True(File.Exists(SegmentedTransfer.PlanPath(path)));
            var servedBeforeResume = server.BytesServed;
            server.Delay = 0;
            await SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, CancellationToken.None);
            Assert.Equal(data, await File.ReadAllBytesAsync(path));
            Assert.True(server.BytesServed - servedBeforeResume < data.Length - (4 << 20), "resume downloaded the finished ranges again");

            // Nouveau contenu sur le serveur entre la pause et la reprise : le fichier repart de zéro, sans mélange.
            var changed = Data(20 << 20, seed: 7);
            server.Delay = 2;
            using (var pause = new CancellationTokenSource())
            {
                var task = SegmentedTransfer.RunAsync(http, server.Request, path, (bytes, _) => { if (bytes > 4 << 20) pause.Cancel(); }, pause.Token);
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);
            }
            server.Replace(changed); server.Delay = 0;
            await SegmentedTransfer.RunAsync(http, server.Request, path, (_, _) => { }, CancellationToken.None);
            Assert.Equal(changed, await File.ReadAllBytesAsync(path));
        }
        finally { Clean(path); }
    }

    private static byte[] Data(int size, int seed = 1) { var bytes = new byte[size]; new Random(seed).NextBytes(bytes); return bytes; }
    private static string Temp() => Path.Combine(Path.GetTempPath(), "sol-segmented-" + Guid.NewGuid().ToString("N") + ".part");
    private static void Clean(string path) { File.Delete(path); File.Delete(SegmentedTransfer.PlanPath(path)); }

    /// <summary>Serveur HTTP minimal : plages, ETag, If-Range, et le nombre de connexions servies en même temps.</summary>
    private sealed class RangeServer : IAsyncDisposable
    {
        private readonly HttpListener _listener = new();
        private readonly bool _ranges;
        private byte[] _data;
        private string _etag = "\"a\"";
        private int _active;
        public int MaxConcurrent, Requests;
        public long BytesServed;
        public int Delay;
        private readonly string _url;

        public RangeServer(byte[] data, bool ranges = true)
        {
            (_data, _ranges) = (data, ranges);
            var port = FreePort();
            _url = $"http://localhost:{port}/file.bin";
            _listener.Prefixes.Add($"http://localhost:{port}/");
            _listener.Start();
            _ = Task.Run(Loop);
        }
        public void Replace(byte[] data) { _data = data; _etag = "\"b\""; }
        public HttpRequestMessage Request() => new(HttpMethod.Get, _url);

        private async Task Loop()
        {
            while (_listener.IsListening)
            {
                HttpListenerContext context;
                try { context = await _listener.GetContextAsync(); } catch (Exception) { return; }
                _ = Task.Run(() => Serve(context));
            }
        }

        private async Task Serve(HttpListenerContext context)
        {
            Interlocked.Increment(ref Requests);
            var now = Interlocked.Increment(ref _active);
            lock (this) MaxConcurrent = Math.Max(MaxConcurrent, now);
            var response = context.Response;
            try
            {
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
                    response.StatusCode = 206;
                    response.Headers["Content-Range"] = $"bytes {from}-{to}/{data.Length}";
                }
                response.Headers["ETag"] = _etag;
                if (_ranges) response.Headers["Accept-Ranges"] = "bytes";
                response.ContentType = "application/octet-stream";
                response.ContentLength64 = to - from + 1;
                for (var offset = from; offset <= to; offset += 64 << 10)
                {
                    var count = (int)Math.Min(64 << 10, to - offset + 1);
                    await response.OutputStream.WriteAsync(data.AsMemory((int)offset, count));
                    Interlocked.Add(ref BytesServed, count);
                    if (Delay > 0) await Task.Delay(Delay);
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

        public ValueTask DisposeAsync() { _listener.Stop(); _listener.Close(); return ValueTask.CompletedTask; }
    }
}
