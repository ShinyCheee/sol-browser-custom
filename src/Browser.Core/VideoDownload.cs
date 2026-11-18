using System.Diagnostics;
using System.Text.Json;

namespace Browser.Core;

public sealed partial class VideoDownload(string url, string referer, string title, string directory, string toolsRoot,
    IReadOnlyList<VideoCookie> cookies, int height = 0, bool direct = false, string? audioUrl = null, bool adaptQuality = false, string? output = null) : IBackgroundDownload
{
    private readonly object _gate = new();
    private string _url = url;
    private readonly string _referer = referer;
    private readonly string _title = title;
    private readonly string _directory = directory;
    private readonly string _toolsRoot = toolsRoot;
    private readonly IReadOnlyList<VideoCookie> _cookies = cookies;
    private readonly int _height = height;
    private bool _direct = direct;
    private readonly string? _audioUrl = audioUrl;
    private readonly bool _adaptQuality = adaptQuality;
    private readonly string? _output = output;
    private readonly string _key = Guid.NewGuid().ToString("N")[..10];
    private CancellationTokenSource? _cancel;
    private Task? _running;
    private bool _resuming;
    private static readonly SemaphoreSlim Slots = new(2, 2);

    public string? RetryUrl => null;
    public event Action? Changed;
    public string State { get; private set; } = "InProgress";
    public string Phase { get; private set; } = "engine.downloader";
    public long BytesReceived { get; private set; }
    public long TotalBytesToReceive { get; private set; }
    public string ResultFilePath { get; private set; } = Path.Combine(directory, VideoSources.FileStem(title) + (VideoAudioFormat.IsAudio(output) ? "." + output : ".mp4"));
    public bool Paused { get; private set; }
    public bool Canceled { get; private set; }
    public bool CanResume => State == "Interrupted" && !Canceled;

    public void Start()
    {
        lock (_gate)
        {
            if (_running is not null || Canceled) return;
            _running = Task.Run(RunAsync);
        }
    }

    public void Pause()
    {
        CancellationTokenSource? cancel;
        lock (_gate)
        {
            if (State != "InProgress" || Canceled) return;
            Paused = true;
            cancel = _cancel;
        }
        try { cancel?.Cancel(); } catch (ObjectDisposedException) { }
    }

    public void Cancel()
    {
        CancellationTokenSource? cancel;
        bool removeNow;
        lock (_gate)
        {
            if (State == "Completed" || Canceled) return;
            Canceled = true;
            Paused = false;
            State = "Interrupted";
            Phase = "canceled";
            cancel = _cancel;
            removeNow = _running is null || _running.IsCompleted;
        }
        try { cancel?.Cancel(); } catch (ObjectDisposedException) { }
        if (removeNow) RemovePartialFiles();
        Changed?.Invoke();
    }

    public async void Resume()
    {
        Task? previous;
        lock (_gate)
        {
            if (!CanResume || _resuming) return;
            _resuming = true;
            previous = _running;
        }
        try
        {
            if (previous is not null) await previous.ConfigureAwait(false);
            lock (_gate)
            {
                if (Canceled || State != "Interrupted") return;
                Paused = false;
                State = "InProgress";
                _running = Task.Run(RunAsync);
            }
        }
        catch
        {
            // RunAsync capture déjà ses exceptions ; ne jamais laisser échapper une erreur d'une méthode async void.
        }
        finally
        {
            lock (_gate) _resuming = false;
        }
    }

    private async Task RunAsync()
    {
        using var cancellation = new CancellationTokenSource();
        lock (_gate)
        {
            _cancel = cancellation;
            if (Canceled || Paused) cancellation.Cancel();
        }
        var ct = cancellation.Token;
        string? jar = null;
        var entered = false;
        try
        {
            if (!VideoAudioFormat.IsValid(_output)) throw new ArgumentException("Unsupported output");
            if (VideoAudioFormat.IsAudio(_output) && !VideoEngine.AudioSupported)
            { lock (_gate) { Phase = "audioUnsupported"; State = "Interrupted"; } return; }
            Phase = "queued"; Changed?.Invoke();
            await Slots.WaitAsync(ct); entered = true;
            Phase = "engine.downloader"; Changed?.Invoke();
            if (_direct)
            {
                try { await DownloadDirectAsync(ct); return; }
                catch (System.Net.Http.HttpRequestException) when (Uri.TryCreate(_url, UriKind.Absolute, out var u) && u.Host.EndsWith(".googlevideo.com", StringComparison.OrdinalIgnoreCase))
                { RemovePartialFiles(); _url = _referer; _direct = false; }
            }
            var tools = await VideoEngine.PrepareAsync(_toolsRoot, p => { Phase = p; Changed?.Invoke(); }, ct);
            ct.ThrowIfCancellationRequested();
            Directory.CreateDirectory(_directory);
            var prefix = VideoSources.FileStem(_title) + " [" + _key + "]" + (VideoAudioFormat.IsAudio(_output) ? ".source" : "");
            if (VideoAudioFormat.IsAudio(_output) && tools.Ffmpeg is null) throw new IOException("Missing audio encoder");
            var start = new ProcessStartInfo(tools.Downloader)
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = System.Text.Encoding.UTF8, StandardErrorEncoding = System.Text.Encoding.UTF8, WorkingDirectory = _directory };
            var args = start.ArgumentList;
            foreach (var a in new[] { "--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-color", "--encoding", "utf-8", "--newline", "--windows-filenames",
                "--no-overwrites", "--continue", "--concurrent-fragments", "8", "--socket-timeout", "30", "--retries", "3", "--fragment-retries", "3",
                "--progress", "--progress-template", "download:SOL_PROGRESS:%(progress)j", "--print", "after_move:SOL_FILE:%(filepath)j",
                "--no-simulate", "--output", prefix + ".%(ext)s", "--format", VideoAudioFormat.IsAudio(_output) ? VideoAudioFormat.Selector : VideoQualitySelection.Selector(_adaptQuality ? 0 : _height, tools.Ffmpeg is not null),
                "--referer", _referer }) args.Add(a);
            if (!VideoAudioFormat.IsAudio(_output) && _adaptQuality && _height > 0) { args.Add("--format-sort"); args.Add($"height:{_height}"); }
            args.Add("--match-filters"); args.Add("!is_live & !is_upcoming & !has_drm");
            if (tools.Ffmpeg is not null) { args.Add("--ffmpeg-location"); args.Add(Path.GetDirectoryName(tools.Ffmpeg)!); }
            if (tools.Runtime is not null) { args.Add("--js-runtimes"); args.Add("deno:" + tools.Runtime); }
            if (_cookies.Count > 0)
            {
                jar = Path.Combine(_toolsRoot, "cookies-" + Guid.NewGuid().ToString("N") + ".txt");
                await File.WriteAllTextAsync(jar, VideoCookie.Jar(_cookies), ct);
                args.Add("--cookies"); args.Add(jar);
            }
            args.Add("--"); args.Add(_url);
            Phase = "download"; Changed?.Invoke();
            using var process = Process.Start(start) ?? throw new IOException("Engine start");
            using var registration = ct.Register(() => { try { process.Kill(entireProcessTree: true); } catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception) { } });
            var errors = DrainErrorsAsync(process.StandardError, ct);
            while (await process.StandardOutput.ReadLineAsync(ct) is { } line) ReadProgress(line);
            await process.WaitForExitAsync(ct);
            var failure = await errors;
            ct.ThrowIfCancellationRequested();
            if (process.ExitCode != 0) { lock (_gate) { Phase = failure; State = "Interrupted"; } }
            else if (!File.Exists(ResultFilePath) || !Path.GetFileName(ResultFilePath).Contains(_key)) throw new IOException("Missing output");
            else
            {
                if (VideoAudioFormat.IsAudio(_output)) await EncodeAudioAsync(tools.Ffmpeg!, ResultFilePath, ct);
                CompleteOutput();
            }
        }
        catch (MissingAudioException) { lock (_gate) if (State != "Completed") { Paused = false; State = "Interrupted"; Phase = "audioMissing"; } }
        catch (OperationCanceledException) { lock (_gate) if (State != "Completed") { State = "Interrupted"; Phase = Canceled ? "canceled" : Paused ? "paused" : "failed"; } }
        catch (Exception) { lock (_gate) if (State != "Completed") { Paused = false; State = "Interrupted"; Phase = Canceled ? "canceled" : "failed"; } }
        finally
        {
            if (entered) Slots.Release();
            if (jar is not null) { try { File.Delete(jar); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { } }
            bool cleanup;
            lock (_gate) { _cancel = null; cleanup = Canceled; }
            if (cleanup) RemovePartialFiles();
            Changed?.Invoke();
        }
    }

    private void CompleteOutput()
    {
        MarkOfTheWeb.Apply(ResultFilePath);
        var length = new FileInfo(ResultFilePath).Length;
        lock (_gate)
        {
            if (Canceled) { State = "Interrupted"; Phase = "canceled"; return; }
            Paused = false;
            BytesReceived = TotalBytesToReceive = length;
            State = "Completed";
            Phase = "done";
        }
    }

    private void RemovePartialFiles()
    {
        try
        {
            foreach (var file in Directory.Exists(_directory) ? Directory.GetFiles(_directory, "*" + _key + "*") : []) File.Delete(file);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    private void ReadProgress(string line)
    {
        if (line.StartsWith("SOL_FILE:"))
        {
            var path = JsonSerializer.Deserialize<string>(line[9..]);
            if (path is not null && Path.GetFullPath(path).StartsWith(Path.GetFullPath(_directory) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                && Path.GetFileName(path).Contains(_key) && (VideoAudioFormat.IsAudio(_output) ? VideoAudioFormat.IsMediaOutput(path) : VideoSources.Kind("https://output.invalid/" + Uri.EscapeDataString(Path.GetFileName(path))) is not null))
                ResultFilePath = path;
        }
        if (!line.StartsWith("SOL_PROGRESS:")) return;
        try
        {
            using var json = JsonDocument.Parse(line[13..]);
            var root = json.RootElement;
            BytesReceived = Number(root, "downloaded_bytes");
            TotalBytesToReceive = Number(root, "total_bytes");
            if (TotalBytesToReceive == 0) TotalBytesToReceive = Number(root, "total_bytes_estimate");
            Phase = root.TryGetProperty("status", out var status) && status.GetString() == "finished" ? "merge" : "download";
            Changed?.Invoke();
        }
        catch (JsonException) { }
    }

    private static long Number(JsonElement root, string key) => root.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var n) ? Math.Max(0, n) : 0;

    private async Task<string> DrainErrorsAsync(StreamReader reader, CancellationToken ct)
    {
        var failure = "failed";
        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (line.StartsWith("SOL_PROGRESS:")) ReadProgress(line);
            else if (VideoAudioFormat.IsAudio(_output) && (line.Contains("matches no streams", StringComparison.OrdinalIgnoreCase)
                || line.Contains("does not contain any stream", StringComparison.OrdinalIgnoreCase)
                || line.Contains("no audio", StringComparison.OrdinalIgnoreCase))) failure = "audioMissing";
            else if (line.Contains("DRM", StringComparison.OrdinalIgnoreCase)) failure = "protected";
            else if (line.Contains("403") || line.Contains("401") || line.Contains("sign in", StringComparison.OrdinalIgnoreCase)) failure = "auth";
        }
        return failure;
    }
}

public sealed record VideoCookie(string Domain, string Path, bool Secure, long Expires, string Name, string Value)
{
    public static System.Net.CookieContainer Container(IEnumerable<VideoCookie> cookies)
    {
        var jar = new System.Net.CookieContainer();
        foreach (var c in cookies)
        {
            try { jar.Add(new System.Net.Cookie(c.Name, c.Value, c.Path, c.Domain) { Secure = c.Secure }); }
            catch (System.Net.CookieException) { }
        }
        return jar;
    }

    public static string Jar(IEnumerable<VideoCookie> cookies) => "# Netscape HTTP Cookie File\n" + string.Join("\n", cookies
        .Where(c => !(c.Domain + c.Path + c.Name + c.Value).Any(ch => ch is '\r' or '\n' or '\t'))
        .Select(c => $"{c.Domain}\t{(c.Domain.StartsWith('.') ? "TRUE" : "FALSE")}\t{c.Path}\t{(c.Secure ? "TRUE" : "FALSE")}\t{c.Expires}\t{c.Name}\t{c.Value}")) + "\n";
}
