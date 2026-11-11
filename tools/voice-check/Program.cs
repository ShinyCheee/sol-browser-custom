using Browser.App;
using System.Collections.Concurrent;

// Real model + real Piper, deterministic WAV input and memory sink: no personal microphone/speaker/account.
if (args.Length != 2) throw new ArgumentException("Expected models directory and synthetic WAV");
Environment.SetEnvironmentVariable("SOL_VOICE_MODELS", Path.GetFullPath(args[0]));
await VoiceRegressions.RunAsync();
var samples = ReadWave(args[1]);
VoiceSegmentation.Run(samples);
var captures = 0;
var recognized = 0;
var resumes = 0;
var output = new ConcurrentBag<MemoryPlayback>();
using var voice = new SolVoiceSession(action => action(), () => { captures++; return new WaveCapture(samples); }, level =>
{ var sink = new MemoryPlayback(level); output.Add(sink); return sink; });
await voice.CheckAssetsAsync("fr");
Require(voice.AssetsReady, "Exact model and voice digests must verify");
Require(SolVoiceWorker.Available, "Packaged native worker must be available");
voice.Recognized += text => { Require(text.Contains("page", StringComparison.OrdinalIgnoreCase) && text.Contains("météo", StringComparison.OrdinalIgnoreCase), "The segmented French request must keep its final instruction"); recognized++; };
voice.ContinueListening += () => resumes++;
voice.ReadAloud = true;
var blocked = true;
var interruptedResume = voice.InterruptAndListenAsync("fr", () => blocked, () => true);
voice.Stop(); blocked = false; await interruptedResume;
Require(captures == 0, "Stop during interrupt wait must invalidate automatic microphone restart");
voice.BeginResponse();voice.AppendResponse("Bonjour.");await voice.FinishResponseAsync(true);
Require(resumes == 0 && captures == 0, "Typing with voice panel open must never arm conversation listening");
for (var turn = 0; turn < 2; turn++)
{
    var started = System.Diagnostics.Stopwatch.StartNew();
    await voice.ListenAsync("fr");
    Console.WriteLine("Transcription turn " + (turn + 1) + ": " + started.ElapsedMilliseconds + " ms");
    Require(voice.Mode == "thinking" && recognized == turn + 1, "One accepted transcript per turn");
    voice.BeginResponse();
    var beforeAudio = output.Sum(s => Interlocked.Read(ref s.Bytes));
    voice.AppendResponse("La page est ouverte. ");
    var deadline = DateTime.UtcNow.AddSeconds(30);
    while (output.Sum(s => Interlocked.Read(ref s.Bytes)) == beforeAudio && DateTime.UtcNow < deadline) await Task.Delay(25);
    Require(output.Sum(s => Interlocked.Read(ref s.Bytes)) > beforeAudio, "New PCM for this turn must arrive before the response finishes");
    voice.AppendResponse("Vous pouvez continuer.");
    await voice.FinishResponseAsync(true);
    Require(resumes == turn + 1, "Conversation should offer a next turn only after speech drained");
}
voice.Stop();
Require(voice.EngineStarts == 1, "Completed turns must reuse one persistent engine process");
Require(voice.Mode == "idle" && voice.Level == 0 && captures == 2, "Stop must leave no capture or automatic restart");
voice.ReadAloud = false;
await voice.ListenAsync("fr");voice.BeginResponse();voice.AppendResponse("Réponse écrite.");await voice.FinishResponseAsync(true);
Require(resumes == 3, "Muted responses must still resume the same natural voice conversation");
var before = recognized;
var pending = voice.ListenAsync("fr"); voice.Stop(); await pending;
Require(recognized == before, "Cancelled native inference must not emit a stale transcript");
Require(voice.Mode == "idle", "Cancellation must leave voice idle");
Console.WriteLine("PASS real French STT, streamed Piper before finish, automatic conversation including muted replies, stop, native cancellation, no microphone/speaker/ChatGPT used");

static void Require(bool condition, string description) { if (!condition) throw new InvalidOperationException(description); }
static short[] ReadWave(string path)
{
    using var reader = new BinaryReader(File.OpenRead(path));
    Require(new string(reader.ReadChars(4)) == "RIFF", "WAV header");reader.ReadInt32();reader.ReadChars(4);
    while (reader.BaseStream.Position < reader.BaseStream.Length)
    {
        var tag = new string(reader.ReadChars(4));var count = reader.ReadInt32();
        if (tag == "data") { var raw = reader.ReadBytes(count);var pcm = new short[raw.Length / 2];Buffer.BlockCopy(raw, 0, pcm, 0, raw.Length);return pcm; }
        reader.BaseStream.Position += count + count % 2;
    }
    throw new InvalidDataException("WAV data missing");
}
sealed class WaveCapture(short[] audio) : ISolVoiceCapture
{
    public Task<short[]> ListenAsync(int device, Action<double, double> level, CancellationToken ct)
    {
        using var segmenter = new SolVoiceSegmenter();
        var noise = Enumerable.Range(0, 32000).Select(i => (short)(1100 * Math.Sin(i * 2 * Math.PI * 60 / 16000))).ToArray();
        var input = noise.Take(4800).Concat(audio.Select((value, i) => (short)Math.Clamp(value + noise[i % noise.Length], short.MinValue, short.MaxValue))).Concat(noise).ToArray();
        for (var offset = 0; offset < input.Length; offset += 320)
        {
            ct.ThrowIfCancellationRequested();
            segmenter.Push(input.AsSpan(offset, Math.Min(320, input.Length - offset)));
            level(segmenter.Activity.Level, segmenter.Activity.Seconds);
        }
        if (!segmenter.Activity.HasSpeech || segmenter.Activity.State != "complete") throw new InvalidOperationException("Real segmentation must finish the noisy WAV before ASR");
        return Task.FromResult(segmenter.Activity.Audio);
    }
    public void Finish() { }
    public void Dispose() { }
}
sealed class MemoryPlayback(Action<double> level) : ISolVoicePlayback
{
    public long Bytes;
    public Task WriteAsync(byte[] pcm, int rate, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (rate != 22050 || pcm.Length % 2 != 0) throw new InvalidDataException("PCM format");
        Interlocked.Add(ref Bytes, pcm.Length);level(.5);return Task.CompletedTask;
    }
    public Task DrainAsync(CancellationToken ct) { ct.ThrowIfCancellationRequested();return Task.CompletedTask; }
    public void Dispose() => level(0);
}
