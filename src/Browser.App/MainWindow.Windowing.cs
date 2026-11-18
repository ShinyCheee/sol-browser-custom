using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;

namespace Browser.App;

public sealed partial class MainWindow
{
    private ChatHost? _chat;
    private DockHost? _dock;

    // Après un changement de profil, la nouvelle fenêtre prend la place de l'ancienne (--bounds=x,y,largeur,hauteur).
    private void PlaceLikePreviousWindow()
    {
        var args = Environment.GetCommandLineArgs();
        const string prefix = "--bounds=";
        var parts = args.FirstOrDefault(a => a.StartsWith(prefix, StringComparison.Ordinal))?[prefix.Length..].Split(',');
        if (parts is { Length: 4 } && parts.All(p => int.TryParse(p, out _)))
        {
            var n = parts.Select(int.Parse).ToArray();
            if (n[2] is >= 400 and <= 10000 && n[3] is >= 300 and <= 10000 && Math.Abs(n[0]) < 20000 && Math.Abs(n[1]) < 20000)
                AppWindow.MoveAndResize(new Windows.Graphics.RectInt32(n[0], n[1], n[2], n[3]));
        }
        if (_settings.FullScreen && (parts is null || args.Contains("--fullscreen"))) AppWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
        else if (parts is null && AppWindow.Presenter is OverlappedPresenter normal) normal.Maximize();
        else if (args.Contains("--maximized") && AppWindow.Presenter is OverlappedPresenter presenter) presenter.Maximize();
    }

    public void SetBrowserFullScreen(bool on, bool maximize = false)
    {
        AppWindow.SetPresenter(on ? AppWindowPresenterKind.FullScreen : AppWindowPresenterKind.Overlapped);
        if (!on && AppWindow.Presenter is OverlappedPresenter presenter)
        {
            presenter.SetBorderAndTitleBar(true, false);
            if (maximize) presenter.Maximize();
        }
    }

    // Plein écran demandé par une page (une vidéo) : la fenêtre couvre l'écran et tout le reste de l'interface
    // s'efface. Échap, ou le bouton du lecteur, ramène l'interface telle qu'elle était.
    private (GridLength Top, GridLength Side, GridLength Panel, Visibility PanelVisible, AppWindowPresenterKind Window, bool Maximized)? _beforeFullScreen;

    private void SetFullScreen(bool on)
    {
        if (on == _beforeFullScreen.HasValue) return;
        var none = new GridLength(0);
        if (on)
        {
            _controller?.HidePopup();
            _controller?.ExtensionPopup?.Hide();
            _beforeFullScreen = (Root.RowDefinitions[0].Height, SidebarColumn.Width, PanelRow.Height, Panel.Visibility,
                AppWindow.Presenter.Kind, (AppWindow.Presenter as OverlappedPresenter)?.State == OverlappedPresenterState.Maximized);
            (Root.RowDefinitions[0].Height, SidebarColumn.Width, PanelRow.Height) = (none, none, none);
            (Ui.Visibility, SidebarGrip.Visibility, Panel.Visibility, PanelGrip.Visibility, PopupFrame.Visibility) =
                (Visibility.Collapsed, Visibility.Collapsed, Visibility.Collapsed, Visibility.Collapsed, Visibility.Collapsed);
            _chat?.SetSuppressed(true);
            _dock?.SetSuppressed(true);
            if (AppWindow.Presenter.Kind != AppWindowPresenterKind.FullScreen) AppWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
        }
        else if (_beforeFullScreen is { } before)
        {
            _beforeFullScreen = null;
            if (before.Window != AppWindowPresenterKind.FullScreen) SetBrowserFullScreen(false, before.Maximized);
            (Root.RowDefinitions[0].Height, SidebarColumn.Width, PanelRow.Height) = (before.Top, before.Side, before.Panel);
            (Ui.Visibility, SidebarGrip.Visibility, Panel.Visibility, PanelGrip.Visibility) =
                (Visibility.Visible, Visibility.Visible, before.PanelVisible, Visibility.Visible);
            _chat?.SetSuppressed(false);
            _dock?.SetSuppressed(false);
        }
    }
}
