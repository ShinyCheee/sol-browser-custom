using Browser.Core;
using System.Threading.Channels;

namespace Browser.App;

public sealed partial class SolVoiceSession
{
    private Channel<string>? _phrases;
    private VoiceSpeechBuffer? _speech;
    private Task _speechTask = Task.CompletedTask;
    private int _speechFailedGeneration = -1;
    public void BeginResponse()
    {
        if (_disposed) return;
        var armed = _turn.Active && _turn.Conversation;
        var previousCapture = _listeningTask;
        var previousSpeech = _speechTask;
        // Atomically supersede capture, transcription, previous playback and its completion callback.
        Stop();
        _turn.Begin(armed, ReadAloud); _cancel = new CancellationTokenSource();
        Mode = "thinking"; Error = null; Level = 0;
        _speech = new VoiceSpeechBuffer();
        // At most 4000 characters per reply, including all queued phrases.
        var phrases = _phrases = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });
        var generation = _turn.Generation;
        var ct = _cancel!.Token;
        _speechTask = Task.Run(async () =>
        {
            // Capture must physically close before output begins, even on a keyboard submission.
            try { await previousCapture; await previousSpeech; } catch (OperationCanceledException) { }
            ct.ThrowIfCancellationRequested();
            await SpeakQueuedAsync(phrases, generation, ct);
        }, ct);
        Changed?.Invoke();
    }
    public void AppendResponse(string delta)
    {
        if (!_turn.Active || !ReadAloud || _speech is null) return;
        foreach (var phrase in _speech.Append(delta)) _phrases?.Writer.TryWrite(phrase);
    }
    public void SpeakNotice(string text)
    {
        if (!_turn.Active || !ReadAloud) return;
        foreach (var phrase in _speech?.Finish() ?? []) _phrases?.Writer.TryWrite(phrase);
        _phrases?.Writer.TryWrite(SolVoiceText.ForSpeech(text));
    }
    private async Task SpeakQueuedAsync(Channel<string> phrases, int generation, CancellationToken ct)
    {
        try
        {
            using var playback = _playbackFactory(level => UpdateLevel(generation, level));
            _playing = playback; playback.SetMuted(!ReadAloud);
            var voice = Path.Combine(ModelsDirectory, _language == "fr" ? "fr_FR-siwis-medium.onnx" : "en_US-lessac-medium.onnx");
            await foreach (var phrase in phrases.Reader.ReadAllAsync(ct))
            {
                if (!ReadAloud) continue;
                Post(generation, () => { Mode = "speaking"; Changed?.Invoke(); });
                await _worker.SpeakAsync(voice, phrase, (audio, rate) => playback.WriteAsync(audio, rate, ct), ct);
            }
            await playback.DrainAsync(ct);
        }
        catch (OperationCanceledException) { }
        catch (Exception e) when (e is IOException or InvalidOperationException or NAudio.MmException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        { Interlocked.Exchange(ref _speechFailedGeneration, generation); Post(generation, () => Fail("speech")); }
        finally { _playing = null; }
    }
    public async Task FinishResponseAsync(bool success)
    {
        var generation = _turn.Generation;
        if (!success) { Stop(); return; }
        foreach (var phrase in _speech?.Finish() ?? []) if (ReadAloud) _phrases?.Writer.TryWrite(phrase);
        _phrases?.Writer.TryComplete();
        try { await _speechTask; } catch (OperationCanceledException) { return; }
        if (!_turn.Accepts(generation) || _disposed) return;
        if (_speechFailedGeneration == generation) { Fail("speech"); return; }
        var again = _turn.Complete(generation, true);
        Mode = "idle"; Level = 0; Changed?.Invoke();
        if (again) ContinueListening?.Invoke(); else Stop();
    }
}
