using Microsoft.Web.WebView2.Core;

namespace Browser.App;

public sealed partial class NetworkInspector
{
    private readonly Dictionary<string, CoreWebView2> _captureCores = new();
    private readonly Dictionary<string, SemaphoreSlim> _captureLocks = new();
    private readonly HashSet<string> _capturing = new();

    public bool IsListeningTo(string tabId, CoreWebView2 core) =>
        _capturing.Contains(tabId) && _captureCores.GetValueOrDefault(tabId) == core;

    public async Task StopCaptureAsync()
    {
        // Keep the bounded history, but release engine response buffers and stop collecting hidden diagnostics.
        await Task.WhenAll(_captureCores.ToArray().Select(pair => SetCaptureAsync(pair.Key, pair.Value, false)));
    }

    private async Task SetCaptureAsync(string id, CoreWebView2 core, bool enabled)
    {
        if (!_captureLocks.TryGetValue(id, out var gate)) _captureLocks[id] = gate = new(1, 1);
        await gate.WaitAsync();
        try
        {
            if (_captureCores.GetValueOrDefault(id) != core) return;
            if (enabled && _capturing.Contains(id)) return;
            if (enabled)
            {
                _capturing.Add(id);
                await core.CallDevToolsProtocolMethodAsync("Network.enable", "{\"maxTotalBufferSize\":4194304,\"maxResourceBufferSize\":1048576,\"maxPostDataSize\":20000}");
                // Runtime.enable replays cached console entries, including activity while the panel was closed.
                await core.CallDevToolsProtocolMethodAsync("Runtime.discardConsoleEntries", "{}");
                await core.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}");
                if (_captureCores.GetValueOrDefault(id) != core) _capturing.Remove(id);
            }
            else
            {
                _capturing.Remove(id);
                await core.CallDevToolsProtocolMethodAsync("Network.disable", "{}");
                await core.CallDevToolsProtocolMethodAsync("Runtime.disable", "{}");
                await core.CallDevToolsProtocolMethodAsync("Runtime.discardConsoleEntries", "{}");
            }
        }
        catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException)
        { _capturing.Remove(id); }
        finally { gate.Release(); }
    }
}
