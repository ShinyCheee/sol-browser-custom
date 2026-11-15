namespace Microsoft.Web.WebView2.Core
{
    public enum CoreWebView2MemoryUsageTargetLevel { Normal, Low }
    public class CoreWebView2
    {
        public CoreWebView2MemoryUsageTargetLevel MemoryUsageTargetLevel { get; set; }
        public Func<Task<bool>> Suspend { get; set; } = () => Task.FromResult(false);
        public int Resumes { get; private set; }
        public Task<bool> TrySuspendAsync() => Suspend();
        public void Resume() { Resumes++; MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal; }
    }
}
namespace Microsoft.UI.Xaml.Controls
{
    public class WebView2 { public Microsoft.Web.WebView2.Core.CoreWebView2? CoreWebView2 { get; set; } }
}
namespace Browser.App
{
    public static class DebugLog { public static void Write(string text) { } }
}
