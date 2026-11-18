using System.Net;
using Browser.Core;

namespace Browser.App;

public sealed partial class SolVoiceSession
{
    private static readonly HttpClient AssetHttp = new(new SafeAssetHandler()) { Timeout = Timeout.InfiniteTimeSpan };
    private CancellationTokenSource? _checking;
    private CancellationTokenSource? _installation;
    private string _language = "";

    public static string ModelsDirectory => Environment.GetEnvironmentVariable("SOL_VOICE_MODELS") is { Length: > 0 } path ? path
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".sol", "voice-models");
    public string CheckedLanguage => _language;
    public bool AssetsReady { get; private set; }
    public bool Installing => _installation is not null;
    public double Progress { get; private set; }

    public async Task CheckAssetsAsync(string language)
    {
        if (Installing || _disposed) return;
        _checking?.Cancel();
        _language = language; Mode = "checking"; Changed?.Invoke();
        var cancel = _checking = new CancellationTokenSource(TimeSpan.FromMinutes(2));
        try { AssetsReady = await new VoiceAssetStore(ModelsDirectory, VoiceAssetStore.ForLanguage(language), AssetHttp).CheckAsync(cancel.Token); }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or OperationCanceledException) { AssetsReady = false; }
        finally
        {
            if (_checking == cancel) { _checking = null; cancel.Dispose(); }
            if (!_disposed && !Installing) { Mode = "idle"; Changed?.Invoke(); }
        }
    }

    public async Task InstallAsync()
    {
        if (Installing || _disposed) return;
        _checking?.Cancel();
        if (_language.Length == 0) _language = Language.Current;
        Stop(); Error = null; Progress = 0; Mode = "installing";
        using var cancel = _installation = new CancellationTokenSource(TimeSpan.FromMinutes(30));
        Changed?.Invoke();
        try
        {
            var last = Environment.TickCount64;
            var store = new VoiceAssetStore(ModelsDirectory, VoiceAssetStore.ForLanguage(_language), AssetHttp);
            await store.InstallAsync(progress =>
            {
                var now = Environment.TickCount64;
                if (now - last < 120 && progress < 1) return;
                last = now;
                _dispatch(() => { if (!_disposed && _installation == cancel) { Progress = progress; Changed?.Invoke(); } });
            }, cancel.Token);
            if (!_disposed && !cancel.IsCancellationRequested) { AssetsReady = true; Mode = "idle"; }
        }
        catch (OperationCanceledException) { if (!_disposed) Mode = "idle"; }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or HttpRequestException)
        { if (!_disposed) { Error = e is InvalidDataException ? "model-invalid" : "model-download"; Mode = "error"; } }
        finally { if (_installation == cancel) _installation = null; if (!_disposed) Changed?.Invoke(); }
    }

    public void CancelInstall() => _installation?.Cancel();

    // Refuse toute redirection HTTPS -> HTTP et impose un délai maximal par lecture de bloc sur le flux.
    private sealed class SafeAssetHandler() : DelegatingHandler(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        ConnectTimeout = TimeSpan.FromSeconds(20),
        AutomaticDecompression = DecompressionMethods.None,
    })
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var current = request.RequestUri ?? throw new HttpRequestException("voice-invalid-uri");
            for (var hop = 0; hop <= 5; hop++)
            {
                if (current.Scheme != Uri.UriSchemeHttps) throw new HttpRequestException("voice-insecure-uri");
                using var step = new HttpRequestMessage(request.Method, current);
                foreach (var header in request.Headers) step.Headers.TryAddWithoutValidation(header.Key, header.Value);
                using var headerDeadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
                headerDeadline.CancelAfter(TimeSpan.FromSeconds(30));
                var response = await base.SendAsync(step, headerDeadline.Token);
                if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } location)
                {
                    response.Dispose();
                    if (hop == 5 || !Uri.TryCreate(current, location, out var next) || next.Scheme != Uri.UriSchemeHttps)
                        throw new HttpRequestException("voice-redirect-blocked");
                    current = next;
                    continue;
                }
                response.Content = new TimedAssetContent(response.Content);
                return response;
            }
            throw new HttpRequestException("voice-redirect-limit");
        }
    }

    private sealed class TimedAssetContent : HttpContent
    {
        private readonly HttpContent _inner;
        public TimedAssetContent(HttpContent inner)
        {
            _inner = inner;
            foreach (var header in inner.Headers) Headers.TryAddWithoutValidation(header.Key, header.Value);
        }
        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context) =>
            await _inner.CopyToAsync(stream);
        protected override bool TryComputeLength(out long length)
        {
            if (_inner.Headers.ContentLength is { } known) { length = known; return true; }
            length = 0; return false;
        }
        protected override async Task<Stream> CreateContentReadStreamAsync(CancellationToken ct) =>
            new ReadTimeoutStream(await _inner.ReadAsStreamAsync(ct));
        protected override void Dispose(bool disposing)
        {
            if (disposing) _inner.Dispose();
            base.Dispose(disposing);
        }
    }

    private sealed class ReadTimeoutStream(Stream inner) : Stream
    {
        private static readonly TimeSpan BlockTimeout = TimeSpan.FromSeconds(45);
        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() => inner.Flush();
        public override int Read(byte[] buffer, int offset, int count) => ReadAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            using var block = CancellationTokenSource.CreateLinkedTokenSource(ct);
            block.CancelAfter(BlockTimeout);
            try { return await inner.ReadAsync(buffer, block.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested) { throw new IOException("voice-read-timeout"); }
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) inner.Dispose();
            base.Dispose(disposing);
        }
    }
}
