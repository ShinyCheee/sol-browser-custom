using Microsoft.Web.WebView2.Core;

namespace Browser.App;

public sealed partial class PageHost
{
    private static readonly Lazy<string> RealtimeMediaScript = new(() =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "inject", "realtime-media.js")));
    private readonly HashSet<CoreWebView2> _realtimeMedia = new();

    private async Task WireRealtimeMediaAsync(string id, CoreWebView2 core)
    {
        var active = new HashSet<object>();
        void SetActivity(object source, bool busy)
        {
            if (Core(id) != core || !(busy ? active.Add(source) : active.Remove(source))) return;
            if (active.Count == 0) _realtimeMedia.Remove(core);
            else if (!_realtimeMedia.Add(core)) return;

            if (!_hiddenSince.ContainsKey(id)) return;
            _hiddenSince[id] = DateTime.UtcNow;
            if (busy) Wake(id, core);
        }

        void Read(object source, CoreWebView2WebMessageReceivedEventArgs message)
        {
            var signal = message.WebMessageAsJson;
            if (signal is not ("\"sol.media.active\"" or "\"sol.media.idle\"")) return;
            if (!Uri.TryCreate(message.Source, UriKind.Absolute, out var uri) ||
                uri.Scheme is not ("https" or "http") || uri.Host is "start.sol" or "ui.navigateur") return;
            SetActivity(source, signal == "\"sol.media.active\"");
        }

        void WatchFrame(CoreWebView2Frame frame)
        {
            frame.WebMessageReceived += (_, message) => Read(frame, message);
            frame.ContentLoading += (_, _) => SetActivity(frame, false);
            frame.Destroyed += (_, _) => SetActivity(frame, false);
        }

        core.WebMessageReceived += (_, message) => Read(core, message);
        core.ContentLoading += (_, _) => SetActivity(core, false);
        core.FrameCreated += (_, e) => WatchFrame(e.Frame);
        await core.AddScriptToExecuteOnDocumentCreatedAsync(RealtimeMediaScript.Value);
    }

    private bool HasLiveMedia(CoreWebView2 core) => _realtimeMedia.Contains(core) || core.IsDocumentPlayingAudio;

    private bool MustKeepAwake(string id, CoreWebView2 core) =>
        HasLiveMedia(core) || KeepAwake(id) || _pip == id || _sims.ContainsKey(id) || _loading.Contains(id);
}
