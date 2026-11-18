using Browser.Core;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

// Téléchargements accélérés, comme IDM : un fichier de 4 Mo ou plus, que son serveur accepte de découper, est repris par
// Sol et téléchargé à plusieurs connexions (voir SegmentedTransfer). Les exécutables, installateurs et scripts restent au
// moteur pour bénéficier du contrôle de réputation SmartScreen natif.
public sealed partial class BrowserController
{
    private static readonly HashSet<string> ExecutableExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".msi", ".msix", ".msixbundle", ".appx", ".appxbundle",
        ".bat", ".cmd", ".ps1", ".vbs", ".vbe", ".js", ".jse", ".wsf",
        ".hta", ".scr", ".lnk", ".com", ".reg", ".pif", ".cpl", ".msc",
    };

    private static bool IsExecutableDownload(string resultFilePath, Uri uri) =>
        ExecutableExtensions.Contains(Path.GetExtension(resultFilePath.TrimEnd(' ', '.')))
        || ExecutableExtensions.Contains(Path.GetExtension(uri.AbsolutePath.TrimEnd(' ', '.', '/')));

    private async Task<bool> AccelerateAsync(string tabId, CoreWebView2DownloadStartingEventArgs e)
    {
        var native = e.DownloadOperation;
        if (!Uri.TryCreate(native.Uri, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length > 0
            || IsExecutableDownload(e.ResultFilePath, uri)
            || native.TotalBytesToReceive < SegmentedTransfer.MinSplit || _pages.CoreOf(tabId) is not { } core) return false;
        try
        {
            var referer = IsWeb(core.Source) ? core.Source : null;
            var cookies = await _pages.VideoCookiesAsync(tabId, native.Uri, referer);
            var userAgent = core.Settings.UserAgent;
            var job = new FileDownload(native.Uri, e.ResultFilePath, referer, userAgent, cookies);
            using (var http = SegmentedTransfer.Client(VideoCookie.Container(cookies)))
            using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(6)))
            {
                var probe = new HttpRequestMessage(HttpMethod.Get, native.Uri);
                if (referer is not null) probe.Headers.Referrer = new Uri(referer);
                probe.Headers.TryAddWithoutValidation("User-Agent", userAgent);
                if (!await SegmentedTransfer.AcceptsRangesAsync(http, probe, native.TotalBytesToReceive, timeout.Token)) return false;
            }
            e.Cancel = true;
            AddVideoDownload(tabId, job);
            DownloadsChanged(throttle: false);
            // Un onglet ouvert seulement pour ce téléchargement n'a plus rien à montrer.
            if (_tabs.Tabs.Count > 1 && core is { CanGoBack: false, Source: "about:blank" })
                _window.DispatcherQueue.TryEnqueue(() => { if (!_closingWindow && _tabs.Tabs.Any(t => t.Id == tabId)) Close(tabId); });
            DebugLog.Write($"download.parallel {tabId} {native.TotalBytesToReceive}");
            return true;
        }
        catch (Exception error) when (error is System.Runtime.InteropServices.COMException or InvalidOperationException or ArgumentException or UriFormatException)
        { return false; }
    }
}
