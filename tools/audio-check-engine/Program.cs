using System.Text.Json;
using Browser.Core;

using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(15));
var ct = timeout.Token;
if (args.Length == 1)
{
    await VideoEngine.PrepareAsync(args[0], Console.WriteLine, ct);
    return;
}
var cookie = new VideoCookie("127.0.0.1", "/", false, 0, "audio_session", "ok");
var job = new VideoDownload(args[1], args[2], "Audio fixture", args[3], args[0], [cookie], direct: args[4] == "direct",
    audioUrl: args.Length > 6 && args[6] != "-" ? args[6] : null, output: args[5]);
var pausedEncoding = false;
job.Changed += () =>
{
    Console.WriteLine(JsonSerializer.Serialize(new { job.State, job.Phase, job.BytesReceived }));
    if (args.Contains("--pause-encode") && job.Phase == "encode" && !pausedEncoding)
    { pausedEncoding = true; job.Pause(); }
    if (args.Contains("--cancel-encode") && job.Phase == "encode" && !job.Canceled) job.Cancel();
};
job.Start();
if (args.Contains("--pause-encode"))
{
    while (job.Phase != "paused") await Task.Delay(10, ct);
    job.Resume();
    while (job.State == "Interrupted") await Task.Delay(10, ct);
}
if (args.Contains("--cancel"))
{
    while (job.State == "InProgress" && job.BytesReceived == 0) await Task.Delay(10, ct);
    job.Cancel();
}
while (job.State == "InProgress") await Task.Delay(30, ct);
// Cancellation cleanup completes after the cancellation state becomes visible.
if (job.Canceled) await Task.Delay(1000, ct);
Console.WriteLine("RESULT:" + JsonSerializer.Serialize(new { job.State, job.Phase, job.ResultFilePath, job.Canceled }));
if (!job.Canceled && job.State != "Completed" && !(args.Contains("--expect-no-audio") && job.Phase == "audioMissing")) Environment.ExitCode = 1;
