using Browser.App;

internal static class VoiceRegressions
{
    public static async Task RunAsync()
    {
        var capture = new HeldCapture();
        var received = 0;
        var audio = 0;
        using var voice = new SolVoiceSession(action => action(), () => capture, _ => new CheckedPlayback(capture, () => audio++));
        Require(voice.Conversation, "Voice must resume naturally by default without choosing instruction/conversation settings");
        await voice.CheckAssetsAsync("fr");
        voice.ReadAloud = true;
        voice.Recognized += _ => received++;
        var recording = voice.ListenAsync("fr");
        Require(capture.Started, "Fixture capture should start");
        var secondCapture = new HeldCapture();
        using (var contender = new SolVoiceSession(action => action(), () => secondCapture))
        {
            await contender.CheckAssetsAsync("fr");await contender.ListenAsync("fr");
            Require(contender.Error == "voice-busy" && !secondCapture.Started, "A second session must not open the microphone while the first owns it");
        }
        voice.BeginResponse(); // A keyboard submission supersedes the pending microphone turn.
        voice.AppendResponse("Votre demande est prête.");
        await voice.FinishResponseAsync(true).WaitAsync(TimeSpan.FromSeconds(75));
        await recording.WaitAsync(TimeSpan.FromSeconds(5));
        Require(received == 0 && capture.Disposed && audio > 0, "Keyboard send must cancel capture before spoken output and suppress its old transcript");
        var before = audio;
        voice.BeginResponse();voice.SpeakNotice("Confirmez cette action.");
        var until = DateTime.UtcNow.AddSeconds(20);
        while (audio == before && DateTime.UtcNow < until) await Task.Delay(20);
        Require(audio > before, "Approval notice should produce real PCM");
        voice.BeginResponse(); // Same method the native approval continuation invokes.
        before = audio;voice.AppendResponse("Action terminée.");await voice.FinishResponseAsync(true).WaitAsync(TimeSpan.FromSeconds(75));
        Require(audio > before && voice.Mode == "idle", "Approving must replace the notice with the remaining spoken reply");
        Console.WriteLine("PASS microphone lease contention; keyboard supersedes capture before playback; approval preserves final spoken response");
    }
    private static void Require(bool value, string message) { if (!value) throw new InvalidOperationException(message); }
    private sealed class HeldCapture : ISolVoiceCapture
    {
        private readonly TaskCompletionSource<short[]> _result = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool Started, Disposed;
        public async Task<short[]> ListenAsync(int device, Action<double, double> level, CancellationToken ct)
        {
            Started = true;
            using var registration = ct.Register(() => _result.TrySetCanceled(ct));
            return await _result.Task;
        }
        public void Finish() { }
        public void Dispose() => Disposed = true;
    }
    private sealed class CheckedPlayback(HeldCapture capture, Action received) : ISolVoicePlayback
    {
        public Task WriteAsync(byte[] pcm, int rate, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();Require(capture.Disposed, "Microphone must close before PCM playback");received();return Task.CompletedTask;
        }
        public Task DrainAsync(CancellationToken ct) => Task.CompletedTask;
        public void Dispose() { }
    }
}
