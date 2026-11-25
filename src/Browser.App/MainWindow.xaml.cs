using Browser.Core;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Input;

namespace Browser.App;

public sealed partial class MainWindow : Window
{
    private static readonly IReadOnlyList<BrowserShortcut> Shortcuts = BrowserShortcuts.All;

    private readonly nint _hwnd;
    private readonly Win32Interop.SubclassProc _wndProc; // gardé en champ : le délégué ne doit pas être libéré
    private BrowserController? _controller;
    private UiBridge? _bridge;
    private SidebarHost? _sidebar;
    private readonly Settings _settings = App.StartupSettings;

    public MainWindow()
    {
        InitializeComponent();
        Title = AppPaths.Profile == Profiles.Default ? "Sol" : $"Sol — {Profiles.NameOf(AppPaths.BaseDir, AppPaths.Profile)}";
        if (AppWindow.Presenter is OverlappedPresenter presenter) presenter.SetBorderAndTitleBar(true, false);
        var icon = Path.Combine(AppContext.BaseDirectory, "Assets", "Sol.ico");
        if (File.Exists(icon)) AppWindow.SetIcon(icon);
        PlaceLikePreviousWindow();

        _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        var singleWindow = TaskbarSingleWindow.Initialize(_hwnd);
        _wndProc = WndProc;
        Win32Interop.SetWindowSubclass(_hwnd, _wndProc, 1, 0);
        Activated += (_, e) =>
        {
            var active = e.WindowActivationState != WindowActivationState.Deactivated;
            SetShortcuts(active);
            _bridge?.SetWindowState(foreground: active);
        };
        AppWindow.Changed += (_, e) =>
        {
            if (e.DidPresenterChange)
                _bridge?.SetWindowState(minimized: (AppWindow.Presenter as OverlappedPresenter)?.State == OverlappedPresenterState.Minimized);
        };
        Closed += (_, _) =>
        {
            SetShortcuts(false);
            singleWindow.Dispose();
            _dividerTimer?.Stop();
            _swipeIdle?.Stop();
        };

        _ = StartInterfaceAsync();
    }

    private async Task InitAsync()
    {
        DebugLog.Write("startup.init");
        var settings = _settings;
        if (settings.ApplyFanDefault()) JsonFileStore.Save(AppPaths.Settings, settings);
        if (settings.Font == "custom") settings.Font = "sf"; // ancien nom du choix « SF Pro »
        var blur = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "inject", "blur.js"));

        UiBridge.Settings = settings;
        Root.Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(UiBridge.InitialBackground);
        StartupShield.Background = Root.Background;
        var pages = new PageHost(Pages, PrimaryColumn, DividerColumn, SecondaryColumn, blur, settings);
        WirePageCursor(pages);
        pages.FullScreenChanged += SetFullScreen;
        var bridge = new UiBridge(Ui, "index.html", pages: pages);
        _bridge = bridge;
        Action onSystemColors = () => DispatcherQueue.TryEnqueue(bridge.BroadcastTheme);
        UiBridge.SystemColorsChanged += onSystemColors;
        Closed += (_, _) =>
        {
            UiBridge.SystemColorsChanged -= onSystemColors;
            bridge.StopAmbient();
        };
        _sidebar = new SidebarHost(SidebarColumn, bridge.Post, () => Root.ActualWidth);
        bridge.SidebarHost = _sidebar;
        WirePresentation(bridge, pages);
        bridge.PageColorChanged += (r, g, b) =>
        {
            Root.Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(Windows.UI.Color.FromArgb(255, r, g, b));
            pages.SetPageColor(r, g, b); // la barre d'état d'un appareil simulé prend la couleur de la page
        };
        var uiFolder = Path.Combine(AppContext.BaseDirectory, "ui");
        var popupBridge = new UiBridge(Popup, "index.html#popup");
        bridge.AttachPopup(popupBridge);
        PopupHost? popup = null;
        popup = new PopupHost(PopupFrame, Popup, popupBridge, () => popupBridge.InitAsync(uiFolder, c =>
        {
            if (c.Type == "ui.ready") popup!.Ready();
            else _controller!.Execute(c);
        }));
        var captureBridge = new UiBridge(CaptureControls, "index.html#capture");
        bridge.AttachPopup(captureBridge);
        PopupHost? capture = null;
        capture = new PopupHost(CaptureFrame, CaptureControls, captureBridge, () => captureBridge.InitAsync(uiFolder, c =>
        {
            if (c.Type == "ui.ready") capture!.Ready();
            else _controller!.Execute(c);
        }));
        Root.SizeChanged += (_, _) => { popup.Rescale(); capture.Rescale(); };
        popup.PageLeft = () => SidebarColumn.ActualWidth;
        popup.PageVertical = () => (Pages.TransformToVisual(Root).TransformPoint(new Windows.Foundation.Point(0, 0)).Y, Pages.ActualHeight);
        var dockBridge = new UiBridge(Dock, "index.html#dock");
        bridge.AttachPopup(dockBridge);
        var dock = _dock = new DockHost(DockFrame, Dock, dockBridge, () => dockBridge.InitAsync(uiFolder, c => _controller!.Execute(c)));
        var panelBridge = new UiBridge(Panel, "index.html#panel");
        bridge.AttachPopup(panelBridge);
        var panel = new PanelHost(PanelRow, Panel, panelBridge, () => panelBridge.InitAsync(uiFolder, c => _controller!.Execute(c)), settings);
        WirePanelGrip(panel, settings);
        var welcomeBridge = new UiBridge(Welcome, "index.html#welcome");
        bridge.AttachPopup(welcomeBridge);
        var welcome = new WelcomeHost(Welcome, welcomeBridge, () => welcomeBridge.InitAsync(uiFolder, c => _controller!.Execute(c)));
        var chatBridge = new UiBridge(Chat, "index.html#chat");
        bridge.AttachPopup(chatBridge);
        var chat = _chat = new ChatHost(ContentArea, ChatColumn, Chat, ChatGrip, chatBridge, () => chatBridge.InitAsync(uiFolder, c => _controller!.Execute(c)), settings);
        WireChatGrip(chat, settings);
        pages.SpellingViews = () => [("ui.chat", chat.IsOpen ? Chat.CoreWebView2 : null, true), ("ui.sidebar", Ui.CoreWebView2, false)];
        _controller = new BrowserController(this, pages, bridge, popup, dock, panel, welcome, settings)
        {
            ExtensionPopup = new ExtensionPopupHost(this, s => { if (_controller is { IsReady: true }) RunShortcut(s); }),
            CapturePanel = capture,
            Chat = chat,
        };
        _controller.NativeZoomChanged += () => SetShortcuts(_shortcutsActive);
        _controller.ShortcutsChanged += () => SetShortcuts(_shortcutsActive);
        WireUiShortcutFallback();
        WireDivider();
        void ApplyInterfaceScale()
        {
            if (_beforeFullScreen is null) Root.RowDefinitions[0].Height = new GridLength(52 * settings.UiFactor);
            _sidebar.Resize(settings.SidebarWidth * settings.UiFactor);
            chat.Rescale();
        }
        _controller.InterfaceScaleChanged += ApplyInterfaceScale;
        Root.SizeChanged += (_, _) => { if (_beforeFullScreen is null) _sidebar.Resize(settings.SidebarWidth * settings.UiFactor); };
        ApplyInterfaceScale();
        WireSidebarGrip(settings);
        WireGestures();

        DebugLog.Write("startup.wired");
        await bridge.InitAsync(uiFolder, _controller.Execute);
        DebugLog.Write("startup.bridge.ready");
        dock.Hide();
    }

    private void WireUiShortcutFallback()
    {
        // Repli local sur l'interface lorsque Ctrl+D / Ctrl+M ne sont pas interceptés globalement pendant un appel WebRTC.
        Ui.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler((_, e) =>
        {
            if (_controller is not { IsReady: true, ActiveTabUsesMediaDevices: true }) return;
            var ctrl = (Win32Interop.GetAsyncKeyState(0x11) & 0x8000) != 0;
            var shift = (Win32Interop.GetAsyncKeyState(0x10) & 0x8000) != 0;
            var alt = (Win32Interop.GetAsyncKeyState(0x12) & 0x8000) != 0;
            if (!ctrl || shift || alt) return;
            var key = (uint)e.Key;
            if (key == 0x44) { e.Handled = true; _controller.Shortcut("bookmark.toggle"); }
            else if (key == 0x4D) { e.Handled = true; _controller.Shortcut("reader.listen"); }
        }), true);
    }

    private bool _shortcutsActive;
    private void SetShortcuts(bool active)
    {
        _shortcutsActive = active;
        var ready = _controller is { IsReady: true };
        var mediaCall = _controller?.ActiveTabUsesMediaDevices == true;
        for (var i = 0; i < Shortcuts.Count; i++)
        {
            Win32Interop.UnregisterHotKey(_hwnd, i);
            if (!active || !ready) continue;
            if (_controller!.UseNativeZoom && Shortcuts[i].Action.StartsWith("zoom.", StringComparison.Ordinal)) continue;
            if (mediaCall && Shortcuts[i].Modifiers == 2 && Shortcuts[i].Key is 0x44 or 0x4D) continue;
            Win32Interop.RegisterHotKey(_hwnd, i, Shortcuts[i].Modifiers | 0x4000 /* MOD_NOREPEAT */, Shortcuts[i].Key);
        }
    }

    // Actions gérées par la fenêtre elle-même avant de passer au contrôleur.
    private void RunShortcut(string action)
    {
        if (action == "sidebar.toggle") { _sidebar?.Toggle(); return; }
        _controller?.Shortcut(action);
    }

    private nint WndProc(nint hwnd, uint msg, nint wParam, nint lParam, nuint id, nuint data)
    {
        if (msg == 0x0312 /* WM_HOTKEY */ && wParam >= 0 && wParam < Shortcuts.Count)
        {
            if (_controller is not { IsReady: true }) return 0;
            var action = Shortcuts[(int)wParam].Action;
            if (action == "address.focus") Ui.Focus(FocusState.Programmatic);
            RunShortcut(action);
            return 0;
        }
        return Win32Interop.DefSubclassProc(hwnd, msg, wParam, lParam);
    }
}
