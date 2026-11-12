using System.Diagnostics;

namespace Browser.Core;

public sealed partial class VideoDownload
{
    private sealed class MissingAudioException : IOException;

    private async Task DownloadDirectAudioAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(directory);
        var source = Path.Combine(directory, VideoSources.FileStem(title) + " [" + _key + "].audio.part");
        // A separate audio track avoids transferring the video. Muxed sources are decoded locally.
        Phase = "download"; BytesReceived = TotalBytesToReceive = 0; Changed?.Invoke();
        if (!File.Exists(source + ".complete") || !File.Exists(source))
        {
            await TransferAsync(audioUrl ?? url, source, (bytes, total) =>
            { BytesReceived = bytes; TotalBytesToReceive = total; Changed?.Invoke(); }, ct);
            // A complete transfer is reusable if paused during engine setup or conversion.
            File.WriteAllText(source + ".complete", "");
        }
        var encoder = await VideoEngine.PrepareAudioAsync(toolsRoot, phase => { Phase = phase; Changed?.Invoke(); }, ct);
        await EncodeAudioAsync(encoder, source, ct);
        File.Delete(source + ".complete");
        BytesReceived = TotalBytesToReceive = new FileInfo(ResultFilePath).Length;
        State = "Completed"; Phase = "done";
    }

    private async Task EncodeAudioAsync(string encoder, string source, CancellationToken ct)
    {
        var target = Path.Combine(directory, VideoSources.FileStem(title) + " [" + _key + "]." + output);
        var pending = Path.Combine(directory, VideoSources.FileStem(title) + " [" + _key + "].encoding." + output);
        File.Delete(pending);
        Phase = "encode"; TotalBytesToReceive = 0; Changed?.Invoke();
        var start = new ProcessStartInfo(encoder)
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, RedirectStandardOutput = true };
        foreach (var arg in new[] { "-nostdin", "-v", "error", "-n", "-protocol_whitelist", "file,pipe", "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn" }
            .Concat(VideoAudioFormat.EncoderArguments(output!)).Append(pending)) start.ArgumentList.Add(arg);
        using var process = Process.Start(start) ?? throw new IOException("Audio encoder start");
        using var kill = ct.Register(() => { try { process.Kill(); } catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception) { } });
        var errors = DrainErrorsAsync(process.StandardError, ct);
        try
        {
            await process.WaitForExitAsync(ct); var failure = await errors; ct.ThrowIfCancellationRequested();
            if (process.ExitCode != 0 && failure == "audioMissing") throw new MissingAudioException();
            if (process.ExitCode != 0 || !File.Exists(pending) || new FileInfo(pending).Length == 0) throw new IOException("Audio encoding failed");
            File.Move(pending, target, true);
            ResultFilePath = target;
            File.Delete(source);
        }
        catch (OperationCanceledException)
        {
            // Release FFmpeg handles before the job removes its canceled output.
            await process.WaitForExitAsync(CancellationToken.None);
            throw;
        }
        finally
        {
            // A retry always starts a fresh encoding from the resumable downloaded source.
            try { File.Delete(pending); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
    }
}
