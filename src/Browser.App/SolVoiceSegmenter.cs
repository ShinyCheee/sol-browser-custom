using Browser.Core;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace Browser.App;

// Silero v6 streaming contract: 512 samples + 64 context, recurrent state [2,1,128].
// Runs on the capture thread, one CPU thread, independent from the slower ASR process.
public sealed class SolVoiceSegmenter : IDisposable
{
    private readonly InferenceSession _session;
    private readonly short[] _frame = new short[512];
    private readonly float[] _input = new float[576];
    private float[] _state = new float[256];
    private int _filled;
    public VoiceActivity Activity { get; } = new();
    public SolVoiceSegmenter()
    {
        using var options = new SessionOptions { InterOpNumThreads = 1, IntraOpNumThreads = 1 };
        options.AddSessionConfigEntry("session.intra_op.allow_spinning", "0");
        _session = new InferenceSession(Path.Combine(AppContext.BaseDirectory, "voice", "runtime", "silero-vad-v6.2.1.onnx"), options);
    }
    public void Push(ReadOnlySpan<short> samples)
    {
        foreach (var value in samples)
        {
            if (Activity.State != "listening") return;
            _frame[_filled++] = value;
            if (_filled != 512) continue;
            _filled = 0;
            for (var i = 0; i < 512; i++) _input[i + 64] = _frame[i] / 32768f;
            var inputs = new[]
            {
                NamedOnnxValue.CreateFromTensor("input", new DenseTensor<float>(_input, [1, 576])),
                NamedOnnxValue.CreateFromTensor("state", new DenseTensor<float>(_state, [2, 1, 128])),
                NamedOnnxValue.CreateFromTensor("sr", new DenseTensor<long>(new long[] { 16000 }, [1])),
            };
            using var output = _session.Run(inputs);
            var probability = output.First(o => o.Name == "output").AsTensor<float>().First();
            _state = output.First(o => o.Name == "stateN").AsTensor<float>().ToArray();
            Array.Copy(_input, 512, _input, 0, 64);
            Activity.Push(_frame, probability);
        }
    }
    public void Dispose() => _session.Dispose();
}
