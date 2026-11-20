using System.Text.Json;
using Browser.Core;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;

namespace Browser.App;

public sealed partial class BrowserController
{
    // Mémoire occupée par le navigateur et les processus de son moteur, pour le réglage d'économie de mémoire.
    private string MemoryHint()
    {
        using var self = System.Diagnostics.Process.GetCurrentProcess();
        long bytes = self.PrivateMemorySize64;
        try
        {
            if (_tabs.ActiveId is { } active && _pages.CoreOf(active) is { } core)
                foreach (var info in core.Environment.GetProcessInfos())
                {
                    try { using var process = System.Diagnostics.Process.GetProcessById(info.ProcessId); bytes += process.PrivateMemorySize64; }
                    catch (Exception e) when (e is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { /* processus déjà parti */ }
                }
        }
        catch (Exception e) when (e is InvalidOperationException or System.Runtime.InteropServices.COMException) { /* moteur indisponible : mémoire du navigateur seul */ }
        var megabytes = bytes / 1024 / 1024;
        var asleep = _pages.AsleepCount;
        return T($"Veille adaptée à la mémoire de ce PC, déchargement après {_pages.DiscardMinutes} minutes sans activité. Utilisé : {megabytes} Mo, {asleep} onglet{(asleep > 1 ? "s" : "")} déchargé{(asleep > 1 ? "s" : "")}.",
            $"Sleep adapts to this PC’s memory; unloads after {_pages.DiscardMinutes} inactive minutes. In use: {megabytes} MB, {asleep} tab{(asleep == 1 ? "" : "s")} unloaded.");
    }

    // Les nouvelles polices s'ajoutent à la fin : le réglage enregistré garde son sens.
    private static readonly string[] Fonts = ["default", "system", "inter", "inter-bold", "sf", "sf-bold",
        "geist", "manrope", "dm-sans", "jakarta", "outfit", "figtree", "nunito", "lora"];

    private void SetFont(int index)
    {
        if (index < 0 || index >= Fonts.Length) return;
        _settings.Font = Fonts[index];
        JsonFileStore.Save(AppPaths.Settings, _settings);
        _bridge.BroadcastTheme(); // la police voyage avec le thème : toutes les vues la reçoivent
        if (_settingsOpen) _popup.Post(SettingsJson());
    }

    private static readonly string[] Languages = ["system", "fr", "en"];

    private void SetLanguage(int index)
    {
        if (index < 0 || index >= Languages.Length) return;
        _settings.Language = Languages[index];
        JsonFileStore.Save(AppPaths.Settings, _settings);
        Language.Current = Language.Resolve(_settings.Language, System.Globalization.CultureInfo.CurrentUICulture.Name);
        OnVoiceLanguageChanged();
        _bridge.BroadcastTheme(); // la langue voyage avec le thème : toutes les vues la reçoivent
        Refresh();
        if (_settingsOpen) _popup.Post(SettingsJson());
    }

    // Page d'accueil : une adresse web. Champ vidé, ou autre chose qu'une adresse web : retour à la page par défaut.
    private void SetHomePage(string input)
    {
        var url = input.Trim().Length == 0 ? "" : Resolve(input);
        _settings.HomePage = IsWeb(url) ? url : Settings.DefaultHomePage;
        JsonFileStore.Save(AppPaths.Settings, _settings);
        if (_settingsOpen) _popup.Post(SettingsJson());
    }

    private void SetSetting(string key, bool on)
    {
        switch (key)
        {
            case "fullscreen":
                _settings.FullScreen = on;
                _window.SetBrowserFullScreen(on, maximize: !on);
                break;
            case "pip": _settings.AutoPip = on; if (!on) _pages.ExitPip(); break;
            case "fanEnabled": _settings.FanEnabled = on; break;
            case "memory": _settings.MemorySaver = on; break;
            case "scrollbars": _settings.HideScrollbars = !on; break;
            case "blur": _settings.BlurEnabled = on; break;
            case "videoDownloads": _settings.VideoDownloads = on; break;
            case "floatingDownloads":
                _settings.FloatingDownloads = on;
                JsonFileStore.Save(AppPaths.Settings, _settings);
                UpdateDock();
                if (_downloadsOpen) _popup.Post(DownloadsJson(_downloads));
                if (_settingsOpen) _popup.Post(SettingsJson());
                return;
            case "onlineSuggestions": _settings.OnlineSuggestions = on; break;
            case "passwords": _settings.SavePasswords = on; break;
            case "startWallpaper": _settings.StartWallpaper = on; _ = PostStartWallpaperAsync(null); break;
            case "tint.topbar": _settings.TintTopbar = on; break;
            case "tint.sidebar": _settings.TintSidebar = on; break;
            case "tint.menus": _settings.TintMenus = on; break;
            case "tint.background": _settings.TintBackground = on; break;
            case "tint.live": _settings.LiveColor = on; break;
            default: return;
        }
        JsonFileStore.Save(AppPaths.Settings, _settings);
        _pages.ApplySettings();
        _bridge.BroadcastTheme();
        UpdateDock();
        Refresh();
        if (_settingsOpen) _popup.Post(SettingsJson());
    }

    // Panneau ouvert par un bouton de la barre : recliquer ce bouton le referme.
    private string? _panel, _panelNext, _panelLast;

    private bool ClosesPanel(string name)
    {
        var open = _panel == name && _popup.IsOpen;
        var justClosed = _panelLast == name && DateTime.UtcNow - _libraryClosedAt < TimeSpan.FromMilliseconds(350);
        if (open) HidePopup();
        if (open || justClosed) return true;
        _panelNext = name;
        return false;
    }

    public void DismissAiPopup() { if (_aiPopup) HidePopup(); }

    public void HidePopup(bool cancelPermissions = true)
    {
        _videoProbeCancel?.Cancel();
        _videoPicker = null; _videoQualities = null;
        _videoCollection = null;
        if (_aiPopup) { _aiPopup = false; CancelAi(); _aiContext = null; _aiBusy = false; }
        _groupEditing = null;
        _siteReset = null;
        _paletteCommands.Clear();
        _paletteItems = null;
        _notesPopup = false;
        _sessionMenuTab = null;
        _translationRequest++;
        _translationSource = null;
        if (_pendingExtension is { } staged)
        {
            _pendingExtension = null;
            try { if (Directory.Exists(staged.Folder)) Directory.Delete(staged.Folder, true); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { DebugLog.Write("extension annulée : " + e.Message); }
        }
        if (_panel is not null) _panelLast = _panel;
        _panel = null;
        _suggesting = false;
        _downloadsOpen = false;
        _settingsOpen = false;
        _voiceSetupOpen = false;
        _profilesOpen = false;
        _extensionsOpen = false;
        if (cancelPermissions) DismissPermissions();
        var dismissed = _menuDismissed;
        (_menu, _menuDismissed) = (null, null);
        dismissed?.Invoke();
        _popup.Hide();
    }

    /// <summary>La page active s'est-elle servie d'un balayage horizontal (carrousel, zone qui défile) tout récemment ?</summary>
    public Task<bool> PageUsedSidewaysAsync(double withinMs) =>
        _tabs.ActiveId is { } id ? _pages.UsedSidewaysAsync(id, withinMs) : Task.FromResult(false);

    public void Shortcut(string action)
    {
        var active = _tabs.ActiveId;
        var index = _tabs.Tabs.ToList().FindIndex(t => t.Id == active);
        switch (action)
        {
            case "history.open" or "downloads.open" or "settings.open" or "profile.menu" or "session.menu" or "translation.open" or "extensions.open":
                _bridge.Post(JsonSerializer.Serialize(new { @event = "invoke-action", data = action == "extensions.open" ? "extensions.menu" : action }));
                break;
            case "library.open":
                Execute(new Command(action, Id: active, X: (_window.Content as FrameworkElement)?.ActualWidth / 2 ?? 450, Y: 70));
                break;
            case string slot when slot.StartsWith("tab.", StringComparison.Ordinal) && int.TryParse(slot.AsSpan(4), out var number) && number is >= 1 and <= 9:
                if (_tabs.Tabs.Count > 0 && (number == 9 || number <= _tabs.Tabs.Count))
                    Execute(new Command("tab.activate", Id: _tabs.Tabs[number == 9 ? _tabs.Tabs.Count - 1 : number - 1].Id));
                break;
            case "tab.next" or "tab.previous" when _tabs.Tabs.Count > 0:
                var step = action == "tab.next" ? 1 : _tabs.Tabs.Count - 1;
                Execute(new Command("tab.activate", Id: _tabs.Tabs[(index + step) % _tabs.Tabs.Count].Id));
                break;
            case "address.focus": _bridge.Post("""{"event":"focus-address"}"""); break;
            case "tab.open" or "tab.reopen" or "window.private": Execute(new Command(action)); break;
            default: if (active is not null) Execute(new Command(action, Id: active)); break;
        }
    }

    private static readonly double[] ZoomSteps = Enumerable.Range(10, 31).Select(step => step / 20d).ToArray();

    private void Zoom(string? id, string action, int? percent = null)
    {
        // Le curseur configure le profil même depuis une page qui possède son propre zoom.
        if (action != "zoom.set" && (id is null || _tabs.Tabs.FirstOrDefault(t => t.Id == id) is not { } tab ||
            (_pages.CoreOf(id)?.Source ?? tab.Url) is Settings.DefaultHomePage or QuickNotes.PageUrl || _pages.IsPdf(id))) return;
        var current = _settings.PageZoom;
        var zoom = action switch
        {
            "zoom.in" => ZoomSteps.FirstOrDefault(z => z > current + 0.001, ZoomSteps[^1]),
            "zoom.out" => ZoomSteps.LastOrDefault(z => z < current - 0.001, ZoomSteps[0]),
            "zoom.set" => percent!.Value / 100d,
            _ => 1,
        };
        if (zoom == current) return;
        _pages.SetZoom(zoom); // toutes les pages du profil, présentes et futures
        JsonFileStore.Save(AppPaths.Settings, _settings);
        if (_settingsOpen) _popup.Post(SettingsJson());
        foreach (var designId in _designTabs.ToArray()) _ = UpdateDesignThemeAsync(designId);
    }

    private OverlappedPresenter? Presenter => _window.AppWindow.Presenter as OverlappedPresenter;
    private bool IsFullScreen => _window.AppWindow.Presenter.Kind == AppWindowPresenterKind.FullScreen;
    private string Resolve(string input) => AddressInput.Resolve(input, _settings.SearchUrlTemplate);
    private static bool IsWeb(string url) =>
        url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("http://", StringComparison.OrdinalIgnoreCase);

    private readonly TabSessions _sessions = new(Path.Combine(AppPaths.DataDir, "tab-sessions.json"));
    private string? _deletingSession;
    private string? _sessionMenuTab;
    private string SessionsJson(string tabId) => JsonSerializer.Serialize(new
    {
        popup = "sessions", id = tabId,
        current = _tabs.Tabs.FirstOrDefault(t => t.Id == tabId)?.SessionId ?? "",
        site = TabSessions.SiteOf(_tabs.Tabs.FirstOrDefault(t => t.Id == tabId)?.Url ?? ""),
        items = _sessions.ForHost(_tabs.Tabs.FirstOrDefault(t => t.Id == tabId)?.Url ?? "")
            .Concat(_sessions.Items.Where(s => s.Id == _tabs.Tabs.FirstOrDefault(t => t.Id == tabId)?.SessionId)).DistinctBy(s => s.Id)
            .Concat(TabSessions.SiteOf(_tabs.Tabs.FirstOrDefault(t => t.Id == tabId)?.Url ?? "") is null ? [] : _sessions.Unassigned).DistinctBy(s => s.Id)
            .Select(s => new { id = s.Id, name = s.Name, count = _tabs.Tabs.Count(t => t.SessionId == s.Id), legacy = s.Site.Length == 0 }),
        deleting = _deletingSession,
    });

    private void OpenSessionMenu(string tabId, double x, double y)
    {
        if (!_tabs.Tabs.Any(t => t.Id == tabId && !t.Private)) return;
        if (ClosesPanel("session-" + tabId)) return;
        HidePopup(); _sessionMenuTab = tabId;
        _popup.Show(x, y, 350, SessionsJson(tabId), focus: true);
    }
}
