using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Browser.App;

/// <summary>
/// Encart flottant en bas à droite de la fenêtre : téléchargements en cours. Sa taille suit son contenu.
/// Coins arrondis par CornerClip, comme les menus.
/// </summary>
public sealed class DockHost(Grid frame, WebView2 view, UiBridge bridge, Func<Task> init)
{
    // La vue de l'encart n'est créée qu'au premier téléchargement : sans téléchargement, elle ne coûte rien.
    private bool _started;
    private string? _last;
    private bool _tracksBounds;
    private double _requestedWidth, _requestedHeight;
    // Un contenu en attente d'affichage garde la vue éveillée : endormie, elle ne pourrait ni le dessiner ni donner sa taille.
    private UiViewRest? _resting;
    private UiViewRest _rest => _resting ??= new(view, () => frame.Visibility == Visibility.Visible || _last is not null, "dock");

    public bool Visible => frame.Visibility == Visibility.Visible && frame.Opacity > 0;

    /// <summary>Envoie le contenu ; l'encart apparaît quand il a annoncé sa taille.</summary>
    public void Post(string json)
    {
        _last = json;
        if (_started)
        {
            _rest.Wake();
            bridge.Post(json);
            // Une nouvelle carte de même hauteur ne déclenche pas forcément le ResizeObserver.
            if (!Visible && _requestedWidth > 0 && _requestedHeight > 0) SetSize(_requestedWidth, _requestedHeight);
            else if (frame.Visibility != Visibility.Visible) Warm();
            return;
        }
        _started = true;
        Warm();
        _ = InitializeAsync(); // l'encart demandera son contenu une fois prêt (voir Ready)
    }

    // Le moteur gèle le code d'une vue jamais affichée : pendant son premier chargement, l'encart est présent mais
    // transparent et inerte, sinon il n'annonce pas sa taille et n'apparaît pas.
    private void Warm()
    {
        frame.Opacity = 0; frame.IsHitTestVisible = false;
        if (!(frame.Width > 0)) frame.Width = 44;
        if (!(frame.Height > 0)) frame.Height = 44;
        frame.Visibility = Visibility.Visible;
    }

    private async Task InitializeAsync()
    {
        try { await init(); }
        catch (Exception error)
        {
            _started = false; // la prochaine progression ou carte pourra réessayer
            DebugLog.Write($"dock.init.failed {error.GetType().Name}");
        }
    }

    /// <summary>L'encart vient de se charger : il reçoit le dernier contenu envoyé.</summary>
    public void Ready()
    {
        if (_last is not null) bridge.Post(_last);
    }

    public void SetSize(double width, double height)
    {
        if (_last is null || !double.IsFinite(width) || !double.IsFinite(height) || width <= 0 || height <= 0) return;
        (_requestedWidth, _requestedHeight) = (width, height);
        var parent = frame.Parent as FrameworkElement;
        if (!_tracksBounds && parent is not null)
        {
            _tracksBounds = true;
            parent.SizeChanged += (_, _) => { if (Visible) SetSize(_requestedWidth, _requestedHeight); };
        }
        var factor = UiBridge.Settings?.UiFactor ?? 0.92;
        var maxWidth = Math.Max(44, Math.Min(360, (parent?.ActualWidth ?? 400) - frame.Margin.Left - frame.Margin.Right));
        var maxHeight = Math.Max(44, Math.Min(420, (parent?.ActualHeight ?? 500) - frame.Margin.Top - frame.Margin.Bottom - 52 * factor));
        frame.Width = Math.Clamp(width, 44, maxWidth);
        frame.Height = Math.Clamp(height, 44, maxHeight);
        if (!Visible) DebugLog.Write("dock.shown");
        frame.Opacity = 1; frame.IsHitTestVisible = true;
        frame.Visibility = Visibility.Visible;
        frame.UpdateLayout();
        CornerClip.Set(view, 16 * (float)(UiBridge.Settings?.UiFactor ?? 0.92)); // beUI Card rounded-2xl.
    }

    public void Hide()
    {
        if (_last is not null && _started) bridge.Post("""{"items":[],"update":null}"""); // pas d'ancienne carte au prochain affichage
        _last = null; // invalide aussi les réponses Ready/size encore en vol
        if (Visible) DebugLog.Write("dock.hidden");
        frame.Visibility = Visibility.Collapsed;
        if (_started) _rest.Rest();
    }
}
