using System.Net.Http;

namespace Browser.Core;

/// <summary>Téléchargement mené hors du moteur web, piloté par l'encart comme ceux du moteur.</summary>
public interface IBackgroundDownload
{
    event Action? Changed;
    string State { get; }
    string Phase { get; }
    long BytesReceived { get; }
    long TotalBytesToReceive { get; }
    string ResultFilePath { get; }
    bool Paused { get; }
    bool Canceled { get; }
    bool CanResume { get; }
    /// <summary>Adresse à rouvrir pour « Réessayer » ; null quand la relance n'a pas de sens.</summary>
    string? RetryUrl { get; }
    void Start();
    void Pause();
    void Resume();
    void Cancel();
}

/// <summary>
/// Un fichier quelconque téléchargé à plusieurs connexions (voir <see cref="SegmentedTransfer"/>), avec la session du
/// site (cookies, référent, agent). Écrit d'abord « .part », puis prend le nom choisi une fois complet.
/// </summary>
public sealed class FileDownload(string url, string resultPath, string? referer, string userAgent, IReadOnlyList<VideoCookie> cookies) : IBackgroundDownload
{
    public event Action? Changed;
    public string State { get; private set; } = "InProgress";
    public string Phase { get; private set; } = "parallel:0";
    public long BytesReceived { get; private set; }
    public long TotalBytesToReceive { get; private set; }
    public string ResultFilePath { get; private set; } = resultPath;
    public bool Paused { get; private set; }
    public bool Canceled { get; private set; }
    public bool CanResume => State == "Interrupted" && !Canceled;
    public string? RetryUrl => url;
    private string Part => resultPath + ".part";
    private CancellationTokenSource? _cancel;
    private Task? _running;
    private bool _resuming;

    public void Start() => _running ??= Task.Run(RunAsync);
    public void Pause() { if (State != "InProgress") return; Paused = true; _cancel?.Cancel(); }
    public void Cancel()
    {
        if (State == "Completed") return;
        Canceled = true; Paused = false; _cancel?.Cancel(); State = "Interrupted";
        if (_running?.IsCompleted == true) RemovePartial();
        Changed?.Invoke();
    }
    public async void Resume()
    {
        if (!CanResume || _resuming) return;
        _resuming = true;
        if (_running is not null) await _running;
        if (Canceled) { _resuming = false; return; }
        Paused = false; State = "InProgress"; _running = Task.Run(RunAsync); _resuming = false;
    }

    private async Task RunAsync()
    {
        using var cancellation = new CancellationTokenSource();
        _cancel = cancellation;
        if (Canceled || Paused) cancellation.Cancel();
        using var http = SegmentedTransfer.Client(VideoCookie.Container(cookies));
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(resultPath)!);
            Phase = "parallel:0"; Changed?.Invoke();
            await SegmentedTransfer.RunAsync(http, Request, Part, (bytes, total) => { BytesReceived = bytes; TotalBytesToReceive = total; Changed?.Invoke(); },
                cancellation.Token, connections: n => { Phase = "parallel:" + n; Changed?.Invoke(); });
            ResultFilePath = Available(resultPath);
            File.Move(Part, ResultFilePath);
            BytesReceived = TotalBytesToReceive = new FileInfo(ResultFilePath).Length;
            State = "Completed"; Phase = "done";
        }
        catch (OperationCanceledException) { State = "Interrupted"; Phase = Canceled ? "canceled" : "paused"; }
        // Toute autre erreur aussi : un téléchargement ne doit jamais rester « en cours » une fois sa tâche finie.
        catch (Exception) { State = "Interrupted"; Phase = "failed"; }
        finally
        {
            _cancel = null;
            if (Canceled) RemovePartial();
            Changed?.Invoke();
        }
    }


    private HttpRequestMessage Request()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (Uri.TryCreate(referer, UriKind.Absolute, out var from) && from.Scheme is "http" or "https") request.Headers.Referrer = from;
        if (userAgent.Length > 0) request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
        return request;
    }

    // Le moteur a réservé ce nom, mais un fichier du même nom a pu apparaître depuis.
    private static string Available(string path)
    {
        if (!File.Exists(path)) return path;
        var (folder, stem, extension) = (Path.GetDirectoryName(path)!, Path.GetFileNameWithoutExtension(path), Path.GetExtension(path));
        for (var n = 2; ; n++) { var candidate = Path.Combine(folder, $"{stem} ({n}){extension}"); if (!File.Exists(candidate)) return candidate; }
    }

    private void RemovePartial()
    {
        foreach (var file in new[] { Part, SegmentedTransfer.PlanPath(Part) })
            try { File.Delete(file); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }
}
