using System.Text.Json;
using Browser.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

// Vue d'interface : synchronise la barre, la sidebar et adapte la couleur de coque à la page active.
public sealed partial class UiBridge(WebView2 view, string page = "index.html", PageHost? pages = null)
{
    private bool _activePrivate;
    private const string Origin = "https://ui.navigateur/";
    private static string? s_lastThemeMsg;
    private static (string Bg, bool Dark, string? Accent)? s_lastProbe;

    /// <summary>Réglages lus pour savoir où la couleur du site doit teinter l'interface.</summary>
    public static Settings? Settings { get; set; }

    public static Windows.UI.Color InitialBackground => Settings?.Theme == "dark" || (Settings?.Theme == "system" && IsSystemDark())
        ? Windows.UI.Color.FromArgb(255, 28, 28, 30) : Windows.UI.Color.FromArgb(255, 238, 240, 226);

    // Thème de Windows, lu par l'hôte : une vue d'interface masquée ne le suit pas de façon fiable par elle-même.
    private static readonly Windows.UI.ViewManagement.UISettings s_system = new();

    private static bool IsSystemDark()
    {
        var c = s_system.GetColorValue(Windows.UI.ViewManagement.UIColorType.Background);
        return c.R + c.G + c.B < 384;
    }

    /// <summary>Prévient quand Windows change de thème ou de couleurs (appelé hors du fil de l'interface).</summary>
    public static event Action? SystemColorsChanged;

    static UiBridge() => s_system.ColorValuesChanged += (_, _) => SystemColorsChanged?.Invoke();

    /// <summary>Envoie les couleurs de la page active à toutes les vues d'interface, avec les réglages de teinte.</summary>
    public void BroadcastTheme()
    {
        UpdateAmbientTimer();
        PublishTheme(force: true);
    }

    private void PublishTheme(bool force = false)
    {
        var on = Settings;
        var systemDark = IsSystemDark();
        if (pages is not null && _activeId is not null && pages.CoreOf(_activeId) is { } ownPage && ownPage.Source is Settings.DefaultHomePage or QuickNotes.PageUrl)
        {
            var wall = ownPage.Source == Settings.DefaultHomePage && on?.StartWallpaper == true;
            var darkStart = on?.Theme == "dark" || (systemDark && (on?.Theme == "system" || (wall && on?.Theme == "page")));
            var photoTint = wall ? WallpaperTint : null;
            var fallback = wall
                ? darkStart ? "rgb(5, 5, 5)" : "rgb(242, 242, 244)"
                : darkStart ? "rgb(9, 9, 11)" : "rgb(238, 240, 226)";
            s_lastProbe = (photoTint ?? fallback, photoTint is not null || darkStart, null);
        }
        if (s_lastProbe is not var (bg, dark, accent)) return;
        accent = AmbientAccent ?? accent; // ce que la page montre à l'instant, sinon la couleur annoncée par le site
        var json = JsonSerializer.Serialize(new
        {
            @event = "theme", bg, dark, accent, mode = on?.Theme ?? "page", systemDark, lang = Language.Current,
            privateMode = AppPaths.Private || _activePrivate,
            font = on?.Font ?? "default",
            uiScale = on?.UiFactor ?? 0.92,
            fan = new { enabled = on?.FanEnabled ?? true, trigger = on?.FanTrigger ?? 2 },
            tint = new { topbar = on?.TintTopbar ?? true, sidebar = on?.TintSidebar ?? true, menus = on?.TintMenus ?? true, background = on?.TintBackground ?? true },
        });
        if (!force && s_lastThemeMsg == json) return;
        s_lastThemeMsg = json;
        view.CoreWebView2?.PostWebMessageAsJson(s_lastThemeMsg);
        foreach (var floating in _floating) floating.Post(s_lastThemeMsg);
        ThemePublished?.Invoke(s_lastThemeMsg);
    }

    public event Action<string>? ThemePublished;
    private string? _activeId;
    private readonly List<UiBridge> _floating = new(); // vues flottantes qui suivent la couleur de la page : menus, encart

    public void AttachPopup(UiBridge floatingBridge) => _floating.Add(floatingBridge);

    /// <summary>Couleur de fond de la page active (rouge, vert, bleu).</summary>
    public event Action<byte, byte, byte>? PageColorChanged;

    public async Task InitAsync(string uiFolder, Action<Command> onCommand)
    {
        var initial = InitialBackground;
        s_lastProbe ??= ($"rgb({initial.R}, {initial.G}, {initial.B})", initial.R < 128, null);
        if (pages is not null || s_lastThemeMsg is null) BroadcastTheme();
        await InitViewAsync(view, page, uiFolder, onCommand);

        if (pages is not null)
        {
            pages.Loaded += id => { if (id == _activeId) ProbeActiveThemeAsync(withDelays: true); };
            pages.PageChanged += (id, _, _) => { if (id == _activeId) ProbeActiveThemeAsync(withDelays: false); };
            StartAmbient();
        }
    }

    private static readonly SemaphoreSlim s_initGate = new(1, 1);

    private async Task InitViewAsync(WebView2 target, string targetPage, string uiFolder, Action<Command> onCommand)
    {
        target.Opacity = 0; // aucune surface du moteur avant la première peinture React
        target.DefaultBackgroundColor = Microsoft.UI.Colors.Transparent;
        var environment = await AdBlock.EnvironmentAsync();
        await s_initGate.WaitAsync();
        try
        {
            DebugLog.Write($"startup.engine.environment {targetPage}");
            var options = environment.CreateCoreWebView2ControllerOptions();
            options.ProfileName = "SolInterface"; // aucune extension de page ne peut injecter du code dans l’interface privilégiée
            await target.EnsureCoreWebView2Async(environment, options);
            DebugLog.Write($"startup.engine.view {targetPage}");
            var core = target.CoreWebView2;
            TaskbarSingleWindow.Shared?.WatchProcess(core.BrowserProcessId);
            core.SetVirtualHostNameToFolderMapping("ui.navigateur", uiFolder, CoreWebView2HostResourceAccessKind.Deny);
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            NativeDownloadUi.Suppress(core);
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;

            // L'interface ne quitte jamais ses fichiers locaux.
            core.NavigationStarting += (_, e) => { if (!e.Uri.StartsWith(Origin, StringComparison.Ordinal)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            var loaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            core.NavigationCompleted += (_, _) =>
            {
                loaded.TrySetResult();
                if (s_lastThemeMsg is not null) core.PostWebMessageAsJson(s_lastThemeMsg);
            };

            BindCommands(target, core, onCommand);

            core.Navigate(Origin + targetPage);
            await Task.WhenAny(loaded.Task, Task.Delay(3000));
        }
        finally { s_initGate.Release(); }
    }

    public void FocusAddress()
    {
        view.Focus(FocusState.Programmatic);
        view.CoreWebView2?.PostWebMessageAsJson("""{"event":"focus-address"}""");
    }

    /// <summary>Carte latérale pilotée par le bouton de la barre.</summary>
    public SidebarHost? SidebarHost { get; set; }

    public void Post(string json)
    {
        view.CoreWebView2?.PostWebMessageAsJson(json);

        // Synchronise la couleur de la coque avec l'onglet actif.
        if (json.Contains("\"activeId\":", StringComparison.Ordinal))
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                _activePrivate = doc.RootElement.TryGetProperty("privateMode", out var privacy) && privacy.GetBoolean();
                if (doc.RootElement.TryGetProperty("activeId", out var prop) && prop.GetString() is { } id)
                {
                    var changed = id != _activeId;
                    _activeId = id;
                    if (changed) { s_ambient = null; ProbeActiveThemeAsync(withDelays: true); }
                }
            }
            catch (JsonException) { }
        }
    }

    /// <summary>Teinte de la photo choisie. Null laisse le thème déterminer la teinte du fond Sol.</summary>
    public static string? WallpaperTint { get; set; }

    /// <summary>La couleur de la page affichée a changé sans navigation (nouveau fond d'accueil) : elle est relue.</summary>
    public void RefreshPageColor() => _ = SampleOnceAsync();
}
