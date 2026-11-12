using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;

namespace Browser.Core;

public sealed partial class VideoDownload
{
    private async Task DownloadDirectAsync(CancellationToken ct)
    {
        if (VideoAudioFormat.IsAudio(output)) { await DownloadDirectAudioAsync(ct); return; }
        Directory.CreateDirectory(directory);
        var stem = Path.Combine(directory, VideoSources.FileStem(title) + " [" + _key + "]");
        var video = stem + ".video.part";
        var audio = stem + ".audio.part";
        Phase = "download"; BytesReceived = 0; TotalBytesToReceive = 0; Changed?.Invoke();
        var counts = new long[2]; var totals = new long[2];
        void Progress(int index, long bytes, long total)
        {
            Interlocked.Exchange(ref counts[index], bytes); Interlocked.Exchange(ref totals[index], total);
            BytesReceived = Interlocked.Read(ref counts[0]) + Interlocked.Read(ref counts[1]);
            TotalBytesToReceive = Interlocked.Read(ref totals[0]) + Interlocked.Read(ref totals[1]);
            Changed?.Invoke();
        }
        // Les premiers octets n'attendent jamais l'installation de l'assembleur.
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var mux = audioUrl is null ? null : VideoEngine.PrepareAsync(toolsRoot, _ => { }, linked.Token);
        async Task<string> Transfer(string source, string path, int index)
        {
            try { return await TransferAsync(source, path, (bytes, total) => Progress(index, bytes, total), linked.Token); }
            catch { linked.Cancel(); throw; }
        }
        var videoTask = Transfer(url, video, 0);
        var audioTask = audioUrl is null ? null : Transfer(audioUrl, audio, 1);
        try
        {
            if (audioTask is not null) await Task.WhenAll(videoTask, audioTask);
            var extension = await videoTask;
            if (audioTask is null)
            {
                ResultFilePath = stem + extension;
                File.Move(video, ResultFilePath, false);
            }
            else
            {
                var tools = await mux!;
                if (tools.Ffmpeg is null) throw new IOException("Missing muxer");
                Phase = "merge"; Changed?.Invoke();
                var audioExtension = await audioTask;
                ResultFilePath = stem + (extension == audioExtension ? extension : ".mkv");
                // Une pause pendant l'assemblage peut laisser une sortie incomplète portant notre clé.
                File.Delete(ResultFilePath);
                var start = new ProcessStartInfo(tools.Ffmpeg) { UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardError = true, RedirectStandardOutput = true };
                foreach (var arg in new[] { "-nostdin", "-v", "error", "-n", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", ResultFilePath })
                    start.ArgumentList.Add(arg);
                using var process = Process.Start(start) ?? throw new IOException("Muxer start");
                using var kill = ct.Register(() => { try { process.Kill(true); } catch (InvalidOperationException) { } });
                var errors = DrainErrorsAsync(process.StandardError, ct);
                await process.WaitForExitAsync(ct); await errors;
                if (process.ExitCode != 0) throw new IOException("Mux failed");
                File.Delete(video); File.Delete(audio);
            }
            BytesReceived = TotalBytesToReceive = new FileInfo(ResultFilePath).Length;
            State = "Completed"; Phase = "done";
        }
        finally { linked.Cancel(); if (mux is not null) { try { await mux; } catch { /* L'erreur du transfert reste prioritaire. */ } } }
    }

    // Plusieurs connexions par piste, comme IDM : les serveurs vidéo limitent souvent le débit de chacune.
    private async Task<string> TransferAsync(string source, string path, Action<long, long> progress, CancellationToken ct)
    {
        using var http = SegmentedTransfer.Client(VideoCookie.Container(cookies));
        HttpRequestMessage Request() { var r = new HttpRequestMessage(HttpMethod.Get, source); r.Headers.Referrer = new Uri(referer); return r; }
        var result = await SegmentedTransfer.RunAsync(http, Request, path, progress, ct,
            accept: mime => !(mime.Contains("html") || mime.Contains("json") || mime.Contains("xml")));
        if (result.Bytes == 0) throw new IOException("Empty media");
        var mime = result.MediaType;
        return mime.Contains("webm") ? ".webm" : mime.Contains("quicktime") ? ".mov" : mime.Contains("matroska") ? ".mkv"
            : mime.Contains("ogg") ? ".ogv" : ".mp4";
    }
}
