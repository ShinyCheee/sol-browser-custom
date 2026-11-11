using Browser.Core;
using NAudio.Wave;
using System.Runtime.InteropServices;

namespace Browser.App;

public sealed class SolVoiceCapture : ISolVoiceCapture
{
    private WaveInEvent? _input;
    private readonly object _gate = new();
    private VoiceActivity? _activity;
    private TaskCompletionSource<short[]>? _completion;
    public static object[] Devices()
    {
        try { return Enumerable.Range(0, WaveInEvent.DeviceCount).Select(i => (object)new { id = i, name = WaveInEvent.GetCapabilities(i).ProductName }).ToArray(); }
        catch (Exception e) when (e is NAudio.MmException or InvalidOperationException) { return []; }
    }
    public async Task<short[]> ListenAsync(int device, Action<double, double> level, CancellationToken ct)
    {
        using var segmenter = new SolVoiceSegmenter();
        _activity = segmenter.Activity;
        var completion = _completion = new(TaskCreationOptions.RunContinuationsAsynchronously);
        _input = new WaveInEvent { DeviceNumber = device, WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 20, NumberOfBuffers = 3 };
        _input.DataAvailable += (_, e) =>
        {
            lock (_gate)
            {
                if (completion.Task.IsCompleted) return;
                try { segmenter.Push(MemoryMarshal.Cast<byte, short>(e.Buffer.AsSpan(0, e.BytesRecorded))); }
                catch (Microsoft.ML.OnnxRuntime.OnnxRuntimeException error) { completion.TrySetException(error); return; }
                level(_activity.Level, _activity.Seconds);
                if (_activity.State != "listening") Complete(completion);
            }
        };
        _input.RecordingStopped += (_, e) => completion.TrySetException(e.Exception ?? new IOException("microphone-stopped"));
        using var registration = ct.Register(() => completion.TrySetCanceled(ct));
        try { _input.StartRecording(); return await completion.Task; }
        finally { Dispose(); }
    }
    public void Finish()
    {
        lock (_gate) if (_completion is { } completion) Complete(completion);
    }
    private void Complete(TaskCompletionSource<short[]> completion)
    {
        if (_activity is null || !_activity.HasSpeech) completion.TrySetException(new IOException(_activity?.State == "timeout" ? "voice-timeout" : "no-speech"));
        else completion.TrySetResult(_activity.Audio);
    }
    public void Dispose()
    {
        var input = Interlocked.Exchange(ref _input, null);
        if (input is null) return;
        try { input.StopRecording(); } finally { input.Dispose(); }
    }
}
