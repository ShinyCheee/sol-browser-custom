namespace Browser.Core;

// 16 kHz mono PCM. The capture supplies a neural speech probability, never a volume threshold.
public sealed class VoiceActivity
{
    private readonly List<short> _audio = [];
    private readonly Queue<short> _preRoll = new();
    private int _elapsed, _voiced, _silence;
    private bool _speaking;
    public string State { get; private set; } = "listening";
    public bool HasSpeech => _voiced >= 3200;
    public double Level { get; private set; }
    public double Seconds => _elapsed / 16000d;
    public short[] Audio => _audio.ToArray();
    public void Push(ReadOnlySpan<short> samples, double probability)
    {
        if (State != "listening" || samples.Length == 0) return;
        var count = Math.Min(samples.Length, 30 * 16000 - _elapsed);
        samples = samples[..count];
        _elapsed += count;
        var energy = 0d;
        foreach (var value in samples) energy += value / 32768d * (value / 32768d);
        var rms = Math.Sqrt(energy / Math.Max(1, count));
        _speaking = double.IsFinite(probability) && probability >= (_speaking ? .35 : .5);
        var speech = _speaking;
        Level = speech ? Math.Clamp(rms * 12, .08, 1) : 0;
        if (_audio.Count == 0 && !speech)
        {
            foreach (var value in samples) { _preRoll.Enqueue(value); if (_preRoll.Count > 4800) _preRoll.Dequeue(); }
        }
        else
        {
            if (_audio.Count == 0) { _audio.AddRange(_preRoll); _preRoll.Clear(); }
            foreach (var value in samples) if (_audio.Count < 30 * 16000) _audio.Add(value);
            if (speech) { _voiced += count; _silence = 0; } else _silence += count;
            if (!HasSpeech && _silence >= 16000) { _audio.Clear(); _voiced = 0; _silence = 0; }
            else if (HasSpeech && _silence >= 16000) State = "complete";
        }
        if (_elapsed >= 30 * 16000) State = HasSpeech ? "complete" : "timeout";
        else if (!HasSpeech && _elapsed >= 20 * 16000) State = "timeout";
    }
}
