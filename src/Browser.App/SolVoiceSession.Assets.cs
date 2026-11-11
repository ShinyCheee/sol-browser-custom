using Browser.Core;

namespace Browser.App;

public sealed partial class SolVoiceSession
{
    private static readonly HttpClient AssetHttp = new() { Timeout = Timeout.InfiniteTimeSpan };
    private CancellationTokenSource? _installation;
    private string _language = "fr";
    public static string ModelsDirectory => Environment.GetEnvironmentVariable("SOL_VOICE_MODELS") is { Length: > 0 } path ? path
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".sol", "voice-models");
    public bool AssetsReady { get; private set; }
    public bool Installing => _installation is not null;
    public double Progress { get; private set; }
    public async Task CheckAssetsAsync(string language)
    {
        if (Installing || _disposed) return;
        _language = language; Mode = "checking"; Changed?.Invoke();
        var cancel = _installation = new CancellationTokenSource(TimeSpan.FromMinutes(2));
        try { AssetsReady = await new VoiceAssetStore(ModelsDirectory, VoiceAssetStore.ForLanguage(language), AssetHttp).CheckAsync(cancel.Token); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or OperationCanceledException) { AssetsReady = false; }
        finally
        {
            if (_installation == cancel) { _installation = null; cancel.Dispose(); }
            if (!_disposed) { Mode = "idle"; Changed?.Invoke(); }
        }
    }
    public async Task InstallAsync()
    {
        if (Installing || _disposed) return;
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
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or HttpRequestException)
        { if (!_disposed) { Error = e is InvalidDataException ? "model-invalid" : "model-download"; Mode = "error"; } }
        finally { if (_installation == cancel) _installation = null; if (!_disposed) Changed?.Invoke(); }
    }
    public void CancelInstall() => _installation?.Cancel();
}
