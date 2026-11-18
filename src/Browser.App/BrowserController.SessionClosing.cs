using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    private bool _savingGitLabSession, _gitLabSessionSaved;

    private void WireGitLabSessionClosing()
    {
        _window.AppWindow.Closing += (sender, args) =>
        {
            if (_gitLabSessionSaved) return;
            args.Cancel = true;
            _ = CloseWithSessionAsync();
        };
    }

    private async Task CloseWithSessionAsync()
    {
        if (_savingGitLabSession) return;
        _savingGitLabSession = true;
        FlushSessionSave();
        try { if (!AppPaths.Private) await _pages.SaveGitLabSessionsAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
        catch (Exception error) { DebugLog.Write($"gitlab.session.close.failed {error.GetType().Name}"); }
        try { await _pages.ClosePrivateTabsAsync().WaitAsync(TimeSpan.FromSeconds(4)); }
        catch (Exception error) { DebugLog.Write($"private.close.failed {error.GetType().Name}"); }
        finally { _gitLabSessionSaved = true; _window.Close(); }
    }
}
