using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

// Keep documents/drafts while releasing inactive WebView caches. React Activity stops
// chat effects where the WinUI controller rejects native suspension.
internal sealed class UiViewRest(WebView2 view, Func<bool> visible, string name, bool suspend = true)
{
    private int _generation;
    public void Wake()
    {
        _generation++;
        try
        {
            if (view.CoreWebView2 is not { } core) return;
            core.Resume();
            core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal;
        }
        catch (Exception e) when (e is InvalidOperationException or System.Runtime.InteropServices.COMException) { }
    }
    public void Rest() => _ = RestAsync(++_generation);
    private async Task RestAsync(int generation)
    {
        // Give XAML time to apply the collapsed visibility before asking WebView2 to suspend.
        await Task.Delay(150);
        if (generation != _generation || visible() || view.CoreWebView2 is not { } core) return;
        try
        {
            if (!suspend)
            {
                core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low;
                DebugLog.Write($"ui.rest {name} low"); return;
            }
            var suspended = await core.TrySuspendAsync();
            if (visible()) { core.Resume(); return; }
            if (!suspended) core.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low;
            DebugLog.Write($"ui.rest {name} {suspended}");
        }
        catch (Exception e) when (e is InvalidOperationException or System.Runtime.InteropServices.COMException)
        { DebugLog.Write($"ui.rest.failed {name} {e.HResult}"); }
    }
}
