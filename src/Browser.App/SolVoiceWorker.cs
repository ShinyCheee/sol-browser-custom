using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Browser.App;

// A single serial worker. Cancellation kills its private process, including native inference.
public sealed class SolVoiceWorker : IDisposable
{
    private Process? _process;
    private readonly SemaphoreSlim _gate = new(1);
    private readonly object _lifetime = new();
    private int _request;
    private bool _disposed;
    private Timer? _idle;
    public int ProcessStarts { get; private set; }
    public static string Runtime => Path.Combine(AppContext.BaseDirectory, "voice", "runtime", "python.exe");
    public static bool Available => System.Runtime.InteropServices.RuntimeInformation.OSArchitecture == System.Runtime.InteropServices.Architecture.X64 && File.Exists(Runtime);
    public Task WarmAsync(string model, CancellationToken ct) => RunAsync(id => new { id, op = "warm", model }, _ => Task.CompletedTask, ct);
    public async Task<string> TranscribeAsync(string model, short[] samples, string language, CancellationToken ct)
    {
        var bytes = new byte[samples.Length * 2]; Buffer.BlockCopy(samples, 0, bytes, 0, bytes.Length);
        var text = "";
        await RunAsync(id => new { id, op = "transcribe", model, audio = Convert.ToBase64String(bytes), language }, message =>
        { if (message.GetProperty("type").GetString() == "text") text = message.GetProperty("text").GetString() ?? ""; return Task.CompletedTask; }, ct);
        return text;
    }
    public Task SpeakAsync(string voice, string text, Func<byte[], int, Task> audio, CancellationToken ct) => RunAsync(
        id => new { id, op = "speak", voice, text }, async message =>
        {
            if (message.GetProperty("type").GetString() == "audio")
                await audio(Convert.FromBase64String(message.GetProperty("audio").GetString()!), message.GetProperty("rate").GetInt32());
        }, ct);
    private async Task RunAsync(Func<int, object> request, Func<JsonElement, Task> message, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(60));
        var external = ct;
        ct = deadline.Token;
        var acquired = false;
        try
        {
            await _gate.WaitAsync(ct); acquired = true;
            Process process;
            lock (_lifetime)
            {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _idle?.Change(Timeout.Infinite, Timeout.Infinite);
            if (_process is null || _process.HasExited)
            {
                _process?.Dispose();
                var start = new ProcessStartInfo(Runtime)
                {
                    UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8,
                    WorkingDirectory = Path.Combine(AppContext.BaseDirectory, "voice"),
                };
                start.ArgumentList.Add("-I"); start.ArgumentList.Add("-u");
                start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "voice", "worker.py"));
                _process = Process.Start(start) ?? throw new IOException("voice-runtime");
                ProcessStarts++;
                _process.ErrorDataReceived += (_, _) => { }; _process.BeginErrorReadLine();
            }
            process = _process;
            }
            using var registration = ct.Register(() => Kill(process));
            var id = ++_request;
            await process.StandardInput.WriteLineAsync(JsonSerializer.Serialize(request(id)).AsMemory(), ct);
            await process.StandardInput.FlushAsync(ct);
            while (await process.StandardOutput.ReadLineAsync(ct) is { } line)
            {
                if (line.Length > 256_000) throw new IOException("voice-protocol");
                using var document = JsonDocument.Parse(line);
                var root = document.RootElement;
                if (root.GetProperty("id").GetInt32() != id) throw new IOException("voice-protocol");
                var type = root.GetProperty("type").GetString();
                if (type == "error") throw new IOException("voice-engine");
                await message(root);
                if (type is "done" or "text") return;
            }
            ct.ThrowIfCancellationRequested();
            throw new IOException("voice-exited");
        }
        catch (OperationCanceledException) when (!external.IsCancellationRequested) { Kill(_process); throw new IOException("voice-slow"); }
        catch { if (acquired) Kill(_process); throw; }
        finally
        {
            if (acquired)
            {
                lock (_lifetime) if (!_disposed)
                {
                    _idle ??= new Timer(_ => { if (_gate.Wait(0)) { try { Kill(_process); } finally { _gate.Release(); } } });
                    _idle.Change(TimeSpan.FromMinutes(2), Timeout.InfiniteTimeSpan);
                }
                _gate.Release();
            }
        }
    }
    private static void Kill(Process? process)
    {
        // Engines run as native libraries inside this one process. Avoid a synchronous
        // system-wide process-tree walk on the UI/cancellation thread on Windows.
        try { if (process is { HasExited: false }) process.Kill(); }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
    }
    public void Dispose() { lock (_lifetime) { _disposed = true; _idle?.Dispose(); Kill(_process); _process?.Dispose(); _process = null; } }
}
