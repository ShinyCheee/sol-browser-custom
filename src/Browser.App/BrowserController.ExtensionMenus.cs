using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    // Bouton de la barre : les extensions actives qui ont une fenêtre, puis l'accès à leur gestion.
    private async Task OpenExtensionsMenuAsync(double x, double y)
    {
        if (PrivateActive) return;
        if (ClosesPanel("extensions")) return;
        var entries = new List<(string Label, Action? Run)>();
        if (EngineProfile is { } profile)
            foreach (var installed in await profile.GetBrowserExtensionsAsync())
                if (installed.IsEnabled && installed.Id != PageZoom.ExtensionId && ExtensionCatalog.Read(ExtensionFolder(installed.Id), installed.Id) is { } info)
                    entries.Add((info.Name, () => _afterMenu = () => ShowExtension(info, x, y)));
        if (entries.Count == 0) { await OpenExtensionsAsync(); return; }
        entries.Add(("", null));
        entries.Add((T("Gérer les extensions…", "Manage extensions…"), () => _afterMenu = () => _ = OpenExtensionsAsync()));
        ShowMenu(x - Scaled(260), y, entries);
    }

    private Dictionary<string, ExtensionInfo> _extensionOffers = new();
    private List<object> _pinnedExtensions = [];
    private bool _pinsInitialized;
    private string? _pinProfileName;
    private static string ExtensionsDir => Path.Combine(AppPaths.DataDir, "extensions");
    private static string ExtensionFolder(string id)
    {
        var folder = Path.Combine(ExtensionsDir, id);
        return Directory.Exists(folder) ? folder : Path.Combine(AppPaths.BaseDir, "extensions", id); // anciennes installations partagées
    }
    private Microsoft.Web.WebView2.Core.CoreWebView2Profile? EngineProfile => _tabs.ActiveId is { } active ? _pages.CoreOf(active)?.Profile : null;

    private async Task<string> ExtensionsJsonAsync()
    {
        var installed = new List<object>();
        var have = new HashSet<string>();
        if (EngineProfile is { } profile)
        {
            await SharedExtensions.SyncAsync(profile);
            foreach (var (id, enabled) in await SharedExtensions.SnapshotAsync())
            {
                if (enabled is null || !ExtensionCatalog.IsId(id) || ExtensionCatalog.Read(ExtensionFolder(id), id) is not { } info) continue;
                have.Add(id);
                installed.Add(new
                {
                    id, name = info.Name, version = info.Version, enabled = enabled.Value, page = true, options = info.Options is not null,
                    pinned = _settings.PinnedExtensions.Contains(id), icon = ExtensionCatalog.Icon(info.Folder),
                    store = info.Store, source = ExtensionCatalog.SourceFolder(info.Folder), update = _extensionUpdates.GetValueOrDefault(id),
                });
            }
        }
        _extensionOffers = await Task.Run(() => BrowserImport.Detect(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData))
            .SelectMany(source => ExtensionCatalog.Scan(source.UserData, source.Name))
            .Where(e => !have.Contains(e.Id) && !e.Name.StartsWith("Comet", StringComparison.OrdinalIgnoreCase))
            .GroupBy(e => e.Id).ToDictionary(g => g.Key, g => g.First()));
        return JsonSerializer.Serialize(new
        {
            popup = "extensions",
            session = _tabs.Tabs.FirstOrDefault(t => t.Id == _tabs.ActiveId)?.SessionId is { Length: > 0 } session ? _sessions.Name(session) : T("Principale", "Main"),
            devMode = _settings.ExtensionDeveloperMode,
            updates = _extensionCheck,
            installed,
            available = _extensionOffers.Values.OrderBy(e => e.Name, StringComparer.OrdinalIgnoreCase).Select(e => new { id = e.Id, name = e.Name, version = e.Version, from = e.From }),
        });
    }

    private async Task OpenExtensionsAsync()
    {
        if (PrivateActive || EngineProfile is not { } profile) return;
        HidePopup();
        var json = await ExtensionsJsonAsync();
        if (_closingWindow || EngineProfile?.ProfileName != profile.ProfileName) return;
        _extensionsOpen = true;
        _popup.ShowCentered(560, json, top: 80);
    }

    private async Task RefreshExtensionsAsync()
    {
        await RefreshPinnedExtensionsAsync();
        if (_extensionsOpen && !_closingWindow) _popup.Post(await ExtensionsJsonAsync());
    }

    private async Task RefreshPinnedExtensionsAsync()
    {
        if (PrivateActive || EngineProfile is not { } profile) return;
        _pinsInitialized = true;
        _pinProfileName = profile.ProfileName;
        var extensions = await profile.GetBrowserExtensionsAsync();
        if (EngineProfile?.ProfileName != profile.ProfileName) return;
        _installedExtensions = extensions.Where(e => e.Id != PageZoom.ExtensionId).Select(e => e.Id).ToHashSet();
        foreach (var gone in _extensionUpdates.Keys.Where(id => !_installedExtensions.Contains(id)).ToList()) _extensionUpdates.Remove(gone);
        _pages.RefreshStore();
        _pinnedExtensions = _settings.PinnedExtensions.Distinct().Where(ExtensionCatalog.IsId)
            .Select(id => extensions.FirstOrDefault(e => e.Id == id && e.IsEnabled))
            .Where(e => e is not null).Select(e => ExtensionCatalog.Read(ExtensionFolder(e!.Id), e.Id))
            .Where(info => info is not null).Select(info => (object)new { id = info!.Id, name = info.Name, icon = ExtensionCatalog.Icon(info.Folder) }).ToList();
        Refresh();
    }

    private async Task PinExtensionAsync(string id)
    {
        if (PrivateActive || !ExtensionCatalog.IsId(id) || EngineProfile is not { } profile
            || !(await profile.GetBrowserExtensionsAsync()).Any(e => e.Id == id)) return;
        if (!_settings.PinnedExtensions.Remove(id)) _settings.PinnedExtensions.Add(id);
        JsonFileStore.Save(AppPaths.Settings, _settings);
        await RefreshExtensionsAsync();
    }

    private bool _installingExtension;
    private ExtensionInfo? _pendingExtension;
    private readonly SemaphoreSlim _extensionChanges = new(1, 1);
    private HashSet<string> _installedExtensions = [];
    private readonly Dictionary<string, string> _extensionUpdates = new();
    private string _extensionCheck = ""; // "", "checking", "current", "updated", "failed"
}
