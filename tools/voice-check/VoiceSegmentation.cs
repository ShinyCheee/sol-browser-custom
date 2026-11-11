using Browser.App;

internal static class VoiceSegmentation
{
    // Replay actual synthetic speech at two gains over continuous hum/hiss, with a real Silero session.
    public static void Run(short[] speech)
    {
        var random = new Random(42);
        var noise = Enumerable.Range(0, 16000 * 20).Select(i => (short)(Math.Sin(i * 2 * Math.PI * 60 / 16000) * 1100 + random.Next(-550, 551))).ToArray();
        using (var silent = new SolVoiceSegmenter())
        {
            for (var offset = 0; offset < noise.Length; offset += 320) silent.Push(noise.AsSpan(offset, Math.Min(320, noise.Length - offset)));
            Require(!silent.Activity.HasSpeech && silent.Activity.State == "timeout", "Continuous background noise must never become a request");
        }
        foreach (var gain in new[] { 1d, .15 })
        {
            var audio = noise.Take(8000).Concat(speech.Select((value, i) => (short)Math.Clamp(value * gain + noise[i % noise.Length], short.MinValue, short.MaxValue)))
                .Concat(noise.Take(48000)).ToArray();
            using var segmenter = new SolVoiceSegmenter();
            var watch = System.Diagnostics.Stopwatch.StartNew();
            for (var offset = 0; offset < audio.Length; offset += 320) segmenter.Push(audio.AsSpan(offset, Math.Min(320, audio.Length - offset)));
            Require(segmenter.Activity.HasSpeech && segmenter.Activity.State == "complete", "Speech, including a quiet microphone, must finish despite continuing room noise");
            Require(segmenter.Activity.Seconds < audio.Length / 16000d - .5, "A request must be sent after a speech pause, without waiting for the capture limit");
            Console.WriteLine($"PASS real VAD gain {gain}: end at {segmenter.Activity.Seconds:F2}s, replay CPU {watch.ElapsedMilliseconds}ms");
        }
    }
    private static void Require(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
}
