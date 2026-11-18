using System.Text.Json;
using Browser.Core;
using Microsoft.UI.Windowing;

namespace Browser.App;

public sealed partial class BrowserController
{
    // Profils : chacun a ses données. Le panneau en change, en crée ou en supprime.
    private bool _profilesOpen;

    private string ProfilesJson() => JsonSerializer.Serialize(new
    {
        popup = "profiles",
        items = Profiles.List(AppPaths.BaseDir).Where(id => id == AppPaths.Profile || !Profiles.IsTemporary(AppPaths.BaseDir, id)).Select(id => new
        {
            id,
            name = ProfileName(id),
            current = id == AppPaths.Profile,
            renamable = id != Profiles.Default && !Profiles.IsTemporary(AppPaths.BaseDir, id),
            deletable = id != Profiles.Default && id != AppPaths.Profile && !IsProfileOpen(id),
        }),
    });

    private void OpenProfileMenu(double x, double y)
    {
        if (ClosesPanel("profile")) return;
        HidePopup();
        _profilesOpen = true;
        _popup.Show(x - Scaled(300), y, 300, ProfilesJson(), focus: true);
    }

    private void AskProfileName() =>
        AskName(T("Nouveau profil", "New profile"), T("Ses onglets, son historique, ses favoris et ses mots de passe restent séparés des autres profils.", "Its tabs, history, bookmarks and passwords stay separate from other profiles."),
            T("Nom du profil", "Profile name"), T("Créer et ouvrir", "Create and open"), "", "profile.create");

    private void DeleteProfile(string id)
    {
        if (id == AppPaths.Profile || IsProfileOpen(id)) return;
        try { Profiles.Delete(AppPaths.BaseDir, id); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* fichiers encore utilisés : le profil reste */ }
        if (_profilesOpen) _popup.Post(ProfilesJson());
    }

    private static bool IsProfileOpen(string id) => App.IsProfileOpen(id);

    private void SwitchProfile(string id) => OpenProfile(id, replace: true);

    private void OpenProfile(string id, bool replace, bool isPrivate = false)
    {
        if (id == AppPaths.Profile || !Profiles.List(AppPaths.BaseDir).Contains(id)) return;
        if (Environment.ProcessPath is not { } exe) return;
        FlushSessionSave();
        var app = _window.AppWindow;
        var shift = replace ? 0 : 36;
        var start = new System.Diagnostics.ProcessStartInfo(exe) { UseShellExecute = false };
        start.ArgumentList.Add($"--profile={id}");
        if (isPrivate) start.ArgumentList.Add("--private");
        start.ArgumentList.Add($"--bounds={app.Position.X + shift},{app.Position.Y + shift},{app.Size.Width},{app.Size.Height}");
        if (replace && Presenter?.State == OverlappedPresenterState.Maximized) start.ArgumentList.Add("--maximized");
        if (replace && IsFullScreen) start.ArgumentList.Add("--fullscreen");
        foreach (var (variable, value) in App.LaunchEnvironment)
        {
            if (value is null) start.Environment.Remove(variable);
            else start.Environment[variable] = value;
        }
        try { System.Diagnostics.Process.Start(start); }
        catch (System.ComponentModel.Win32Exception) { return; }
        if (replace) _ = CloseWithSessionAsync();
    }

    // Bouton de capture d'écran de la barre d'outils.
    private void OpenCaptureMenu()
    {
        if (_capture.Busy) return;
        if (CapturePanel?.IsOpen == true) { CapturePanel.Hide(); return; }
        HidePopup();
        CapturePanel?.ShowBottom(640, JsonSerializer.Serialize(new { @event = "capture-open", mode = "visible", device = _tabs.ActiveId is { } shown && _pages.DeviceOf(shown) is not null }));
    }

    private void Capture(string mode, bool browser = false)
    {
        var tab = _tabs.Tabs.FirstOrDefault(t => t.Id == _tabs.ActiveId);
        if (browser) _ = _capture.RunWindowAsync(null, mode, T("du navigateur", "of browser"));
        else if (tab is not null && mode != "full" && _pages.DeviceArea(tab.Id) is { } devices) _ = _capture.RunWindowAsync(devices, mode, tab.Title);
        else if (tab is not null && _pages.CoreOf(tab.Id) is { } core) _ = _capture.RunAsync(core, mode, tab.Title);
    }

    private static readonly HashSet<string> NativeCommands =
    [
        "back", "forward", "reload", "cut", "copy", "paste", "selectAll",
        "copyLinkLocation", "saveLinkAs", "copyImage", "copyImageLocation", "saveImageAs",
        "saveAs", "print", "viewPageSource", "inspectElement", "spellCheck",
    ];

    private static string DeviceLabel(string name) => name switch
    {
        "iPhone Duo cover" => T("iPhone Duo (plié)", "iPhone Duo (folded)"),
        "Desktop" => T("Ordinateur", "Desktop"),
        PageHost.Comparison => T("Comparaison", "Comparison"),
        _ => name,
    };

    private const int MinCompared = 2, MaxCompared = 4;

    private void ApplyComparison()
    {
        var known = Device.All.Select(d => d.Name).Where(_settings.CompareDevices.Contains).ToList();
        _pages.ComparisonDevices = known.Count is >= MinCompared and <= MaxCompared ? known : Device.DefaultComparison;
    }

    private void AskComparison(string tabId)
    {
        HidePopup();
        _popup.ShowCentered(340, JsonSerializer.Serialize(new
        {
            popup = "compare-pick", id = tabId, min = MinCompared, max = MaxCompared,
            devices = Device.All.Select(d => new { name = d.Name, label = DeviceLabel(d.Name), size = $"{d.Width} × {d.Height}", on = _pages.ComparisonDevices.Contains(d.Name) }),
        }), top: 64);
    }
}
