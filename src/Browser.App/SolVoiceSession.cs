using Browser.Core;

namespace Browser.App;

public interface ISolVoiceCapture : IDisposable
{
    Task<short[]> ListenAsync(int device, Action<double, double> level, CancellationToken ct);
    void Finish();
}
public interface ISolVoicePlayback : IDisposable
{
    Task WriteAsync(byte[] pcm, int rate, CancellationToken ct);
    Task DrainAsync(CancellationToken ct);
    void SetMuted(bool muted) { }
}

public sealed partial class SolVoiceSession : IDisposable
{
    private readonly Action<Action> _dispatch;
    private readonly Func<ISolVoiceCapture> _captureFactory;
    private readonly Func<Action<double>, ISolVoicePlayback> _playbackFactory;
    private readonly SolVoiceWorker _worker = new();
    private readonly VoiceTurn _turn = new();
    private CancellationTokenSource? _cancel;
    private ISolVoiceCapture? _capture;
    private FileStream? _microphoneLease;
    private bool _disposed;
    private long _lastLevel;
    private Task _listeningTask = Task.CompletedTask;
    public bool Conversation => true;
    private bool _readAloud = true;
    private ISolVoicePlayback? _playing;
    public bool ReadAloud
    {
        get => _readAloud;
        set { _readAloud = value; _playing?.SetMuted(!value); if (!value && Mode == "speaking") Mode = "thinking"; Changed?.Invoke(); }
    }
    public int Device { get; set; } = -1;
    public string Mode { get; private set; } = "idle";
    public string Text { get; private set; } = "";
    public string? Error { get; private set; }
    public double Level { get; private set; }
    public double Seconds { get; private set; }
    public int EngineStarts => _worker.ProcessStarts;
    public event Action? Changed;
    public event Action<string>? Recognized;
    public event Action? ContinueListening;
    public SolVoiceSession(Action<Action> dispatch, Func<ISolVoiceCapture>? capture = null, Func<Action<double>, ISolVoicePlayback>? playback = null)
    {
        _dispatch = dispatch; _captureFactory = capture ?? (() => new SolVoiceCapture());
        _playbackFactory = playback ?? (level => new SolVoicePlayback(level));
    }
    public Task ListenAsync(string language) => _listeningTask = ListenCoreAsync(language);
    private async Task ListenCoreAsync(string language)
    {
        if (_disposed) return;
        Stop();
        if (!AssetsReady) { Fail("model-missing"); return; }
        var generation = _turn.Begin(Conversation, ReadAloud);
        var cancel = _cancel = new CancellationTokenSource(TimeSpan.FromSeconds(75));
        var capture = _capture = _captureFactory();
        try
        {
            Directory.CreateDirectory(ModelsDirectory);
            try { _microphoneLease = new FileStream(Path.Combine(ModelsDirectory, "microphone.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException) { throw new IOException("voice-busy"); }
            Text = ""; Error = null; Mode = "listening"; Seconds = 0; Changed?.Invoke();
            // Load ASR concurrently with capture, rather than after the user finishes speaking.
            var warm = _worker.WarmAsync(Path.Combine(ModelsDirectory, "parakeet-ultra-Q8_0.gguf"), cancel.Token);
            _ = warm.ContinueWith(task => _ = task.Exception, TaskContinuationOptions.OnlyOnFaulted);
            var samples = await capture.ListenAsync(Device, (level, seconds) => UpdateLevel(generation, level, seconds), cancel.Token);
            _microphoneLease?.Dispose(); _microphoneLease = null;
            if (!_turn.Accepts(generation)) return;
            Mode = "transcribing"; Level = 0; Changed?.Invoke();
            await warm;
            var text = await _worker.TranscribeAsync(Path.Combine(ModelsDirectory, "parakeet-ultra-Q8_0.gguf"), samples, language, cancel.Token);
            if (!_turn.Accepts(generation)) return;
            if (string.IsNullOrWhiteSpace(text)) { Fail("no-speech"); return; }
            Text = text; Mode = "thinking"; Changed?.Invoke(); Recognized?.Invoke(text);
        }
        catch (OperationCanceledException) { if (_turn.Accepts(generation)) Fail("voice-slow"); }
        catch (Exception e) when (e is IOException or InvalidOperationException or UnauthorizedAccessException or NAudio.MmException or System.ComponentModel.Win32Exception or Microsoft.ML.OnnxRuntime.OnnxRuntimeException)
        {
            if (_turn.Accepts(generation)) Fail(e.Message is "voice-busy" or "voice-timeout" or "no-speech" or "voice-slow" ? e.Message : Mode == "listening" ? "microphone" : "recognition");
        }
        finally
        {
            _microphoneLease?.Dispose(); _microphoneLease = null;
            try { capture.Dispose(); }
            catch (Exception e) when (e is NAudio.MmException or InvalidOperationException) { if (_turn.Accepts(generation)) Fail("microphone"); }
            if (_capture == capture) _capture = null;
        }
    }
    private void UpdateLevel(int generation, double level, double seconds = 0)
    {
        var now = Environment.TickCount64;
        if (now - Interlocked.Read(ref _lastLevel) < 80) return;
        Interlocked.Exchange(ref _lastLevel, now);
        Post(generation, () => { Level = level; if (seconds > 0) Seconds = seconds; Changed?.Invoke(); });
    }
    private void Post(int generation, Action action) => _dispatch(() => { if (!_disposed && _turn.Accepts(generation)) action(); });
    public void FinishCapture() => _capture?.Finish();
    public async Task ChangeDeviceAsync(int device, string language)
    {
        Device = device;
        if (Mode != "listening") { Changed?.Invoke(); return; }
        var previous = _listeningTask;
        Stop(); var generation = _turn.Generation;
        await previous;
        if (!_disposed && generation == _turn.Generation) await ListenAsync(language);
    }
    public async Task InterruptAndListenAsync(string language, Func<bool> busy, Func<bool> canContinue)
    {
        Stop();
        var generation = _turn.Generation;
        for (var n = 0; busy() && n < 100 && generation == _turn.Generation; n++) await Task.Delay(50);
        if (!_disposed && !busy() && generation == _turn.Generation && canContinue()) await ListenAsync(language);
    }
    public void Stop()
    {
        _turn.Stop(); _cancel?.Cancel(); _cancel?.Dispose(); _cancel = null;
        _phrases?.Writer.TryComplete(); _phrases = null;
        _microphoneLease?.Dispose(); _microphoneLease = null;
        Mode = "idle"; Level = 0; Error = null; Changed?.Invoke();
    }
    private void Fail(string error)
    {
        Stop(); Error = error; Mode = error == "voice-timeout" ? "paused" : "error"; Changed?.Invoke();
    }
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true; _installation?.Cancel(); Stop(); _worker.Dispose();
    }
}
