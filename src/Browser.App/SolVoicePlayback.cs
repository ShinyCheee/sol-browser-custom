using NAudio.Wave;
using System.Runtime.InteropServices;

namespace Browser.App;

public sealed class SolVoicePlayback(Action<double> level) : ISolVoicePlayback
{
    private WaveOutEvent? _output;
    private BufferedWaveProvider? _buffer;
    private int _rate;
    private bool _muted;
    private readonly object _gate = new();
    public void SetMuted(bool muted)
    {
        lock (_gate)
        {
            _muted = muted;
            if (muted) { _output?.Stop(); _buffer?.ClearBuffer(); level(0); }
            else _output?.Play();
        }
    }
    public async Task WriteAsync(byte[] pcm, int rate, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (rate is < 8000 or > 48000 || pcm.Length % 2 != 0) throw new IOException("voice-format");
        lock (_gate)
        {
            if (_muted) return;
            if (_output is null)
            {
            _rate = rate;
            _buffer = new BufferedWaveProvider(new WaveFormat(rate, 16, 1)) { BufferDuration = TimeSpan.FromSeconds(3), ReadFully = true };
            _output = new WaveOutEvent { DesiredLatency = 100 };
            _output.Init(_buffer); _output.Play();
            }
        }
        if (rate != _rate) throw new IOException("voice-rate");
        while (_buffer?.BufferedDuration.TotalSeconds > 1) await Task.Delay(40, ct);
        lock (_gate) { if (_muted) return; _buffer?.AddSamples(pcm, 0, pcm.Length); }
        var energy = 0d;
        foreach (var value in MemoryMarshal.Cast<byte, short>(pcm.AsSpan())) energy += (double)value * value;
        level(Math.Clamp(Math.Sqrt(energy / Math.Max(1, pcm.Length / 2)) / 32768d * 5, 0, 1));
    }
    public async Task DrainAsync(CancellationToken ct)
    {
        while (_buffer?.BufferedBytes > 0) await Task.Delay(40, ct);
        // Last submitted device buffer must finish before the microphone can reopen.
        if (_output is not null) await Task.Delay(180, ct);
        level(0);
    }
    public void Dispose() { lock (_gate) { _output?.Stop(); _output?.Dispose(); _output = null; _buffer = null; level(0); } }
}
