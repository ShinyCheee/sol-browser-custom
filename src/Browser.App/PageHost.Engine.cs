using Browser.Core;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

public sealed partial class PageHost
{
    // Toutes les vues partagent le même moteur. Une fenêtre privée aussi : elle a son propre dossier de données, effacé
    // à sa fermeture, ce qui laisse le bloqueur de publicités y fonctionner (le mode privé du moteur l'en empêcherait).
    private async Task StartEngineAsync(WebView2 view, string? profileName = null)
    {
        var name = profileName ?? "Default";
        if (_closingProfiles.TryGetValue(name, out var closing))
        { await closing; if (_closingProfiles.GetValueOrDefault(name) == closing) _closingProfiles.Remove(name); }
        var environment = await AdBlock.EnvironmentAsync();
        if (profileName is null) await view.EnsureCoreWebView2Async(environment);
        else
        {
            var options = environment.CreateCoreWebView2ControllerOptions();
            options.ProfileName = profileName;
            await view.EnsureCoreWebView2Async(environment, options);
        }
        TaskbarSingleWindow.Shared?.WatchProcess(view.CoreWebView2.BrowserProcessId);
        var profile = view.CoreWebView2.Profile;
        await StartupPreparation.OptionalAsync("private-cleanup", async () =>
        {
            if (_privateCleanup is null || _privateCleanup.IsFaulted || _privateCleanup.IsCanceled)
                _privateCleanup = DeleteAbandonedPrivateProfilesAsync(profile);
            await _privateCleanup;
        }, (stage, error) => RecordStartupFailure(stage, error, PrivateBrowsing.IsProfile(profile.ProfileName)));
        RestoreGitLabSession(profile);
        WatchGitLabSession(view.CoreWebView2);
        if (_sessionCookies.Remove(profile.ProfileName, out var cookies))
            foreach (var cookie in cookies) profile.CookieManager.AddOrUpdateCookie(cookie);
        ApplySessionSeed(profile);
    }

    public async Task<bool> DeleteSessionAsync(string sessionId)
    {
        if (!TabSessions.ValidId(sessionId)) return false;
        var name = "sol-" + sessionId;
        _profileReady.Remove(name);
        _sessionCookies.Remove(name);
        _sessionSeeds.Remove(name);
        _gitLabRestored.Remove(name);
        try { if (File.Exists(GitLabFile(name))) File.Delete(GitLabFile(name)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        var engine = Path.Combine(Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER") ?? AppPaths.WebData, "EBWebView");
        if (!Directory.Exists(Path.Combine(engine, "WV2Profile_" + name))) return true;
        var view = new WebView2 { Opacity = 0, IsHitTestVisible = false, Width = 1, Height = 1 };
        container.Children.Add(view);
        try
        {
            await StartEngineAsync(view, name);
            // L'API moteur marque le profil pour suppression après fermeture de ses vues.
            view.CoreWebView2.Profile.Delete();
            _profileReady.Remove(name);
            _sessionCookies.Remove(name);
            return true;
        }
        catch (Exception e) when (e is InvalidOperationException or System.Runtime.InteropServices.COMException)
        { return false; }
        finally { container.Children.Remove(view); view.Close(); }
    }
}
