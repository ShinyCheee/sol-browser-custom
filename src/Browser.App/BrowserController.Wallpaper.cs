using System.Text.Json;
using Browser.Core;
using Windows.Graphics.Imaging;

namespace Browser.App;

// Fond de la page d'accueil : l'image de Sol, une photo choisie, ou une nouvelle photo chaque jour.
public sealed partial class BrowserController
{
    // Une photo de 2560 pixels sur une connexion lente : plus de temps que les requêtes courtes du navigateur.
    private static readonly HttpClient WallpaperHttp = new()
    {
        Timeout = TimeSpan.FromSeconds(90),
        MaxResponseContentBufferSize = MaxWallpaper,
        DefaultRequestHeaders = { { "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sol" } },
    };
    private const int MaxWallpaper = 8_000_000;
    // Commun à tous les profils : une photo téléchargée ne l'est qu'une fois.
    private static string WallpaperFolder => Path.Combine(AppPaths.BaseDir, "wallpapers");
    private (int Id, string Data, (byte R, byte G, byte B) Color)? _wallpaperLoaded;
    private int _wallpaperRequest;

    private StartWallpaper? CurrentWallpaper => _settings.StartWallpaper && !_settings.StartWallpaperDaily && _settings.StartWallpaperCustom
        ? new(-1, "", "", 40, 68, 105) : StartWallpapers.Selected(_settings, DateOnly.FromDateTime(DateTime.Now));

    private void SetWallpaper(int photo)
    {
        if (photo != 0 && StartWallpapers.Find(photo) is null) return;
        _settings.StartWallpaperCustom = false;
        (_settings.StartWallpaperPhoto, _settings.StartWallpaperDaily) = (photo, false);
        WallpaperChanged();
    }

    private void SetWallpaperDaily(bool daily)
    {
        _settings.StartWallpaperDaily = daily;
        WallpaperChanged();
    }

    private void WallpaperChanged()
    {
        JsonFileStore.Save(AppPaths.Settings, _settings);
        Refresh(); // les pages d'accueil apprennent quelle image attendre
        _ = PostStartWallpaperAsync(null);
        if (_settingsOpen) _popup.Post(SettingsJson());
    }

    /// <summary>Envoie la photo aux pages d'accueil ouvertes (ou à une seule). Sans photo, ou si elle n'a pas pu être
    /// téléchargée, la page garde l'image livrée avec Sol.</summary>
    private async Task PostStartWallpaperAsync(string? tabId)
    {
        // Un nouveau choix remplace les envois en cours ; l'ouverture d'un onglet, non.
        var request = tabId is null ? ++_wallpaperRequest : _wallpaperRequest;
        var wanted = CurrentWallpaper;
        string? data = null;
        (byte R, byte G, byte B)? color = null;
        if (wanted is not null)
        {
            if (_wallpaperLoaded is not { } cached || cached.Id != wanted.Id)
            {
                if (_bridge.WallpaperTint is not null)
                {
                    _bridge.WallpaperTint = null;
                    _bridge.BroadcastTheme();
                    _bridge.RefreshPageColor();
                }
                var bytes = await LoadWallpaperAsync(wanted);
                if (bytes is not null)
                {
                    var sampled = await Task.Run(() => WallpaperColorAsync(bytes, wanted.Tint));
                    if (!_closingWindow && request == _wallpaperRequest)
                        _wallpaperLoaded = (wanted.Id, "data:image/jpeg;base64," + Convert.ToBase64String(bytes), sampled);
                }
                if (_closingWindow || request != _wallpaperRequest) return; // un autre choix a été fait entre-temps : son envoi suit
            }
            if (_wallpaperLoaded is { } loaded && loaded.Id == wanted.Id) (data, color) = (loaded.Data, loaded.Color);
        }
        if (_bridge.WallpaperTint != color) { _bridge.WallpaperTint = color; _bridge.BroadcastTheme(); _bridge.RefreshPageColor(); }
        var tint = color is { } c ? $"rgb({c.R}, {c.G}, {c.B})" : null;
        var json = JsonSerializer.Serialize(new
        {
            @event = "start-wallpaper", url = data ?? "", tint,
            author = data is null || wanted?.Id == -1 ? null : wanted!.Author, page = data is null || wanted?.Id == -1 ? null : wanted!.Page,
        });
        foreach (var tab in _tabs.Tabs.Where(t => t.Url == Settings.DefaultHomePage && (tabId is null || t.Id == tabId) && !_pages.IsAsleep(t.Id)))
            _pages.PostStart(tab.Id, json);
    }

    // La photo est lue dans le dossier commun ou téléchargée à la première utilisation.
    private static async Task<byte[]?> LoadWallpaperAsync(StartWallpaper wallpaper)
    {
        var file = Path.Combine(WallpaperFolder, wallpaper.Id + ".jpg");
        try
        {
            if (wallpaper.Id == -1) return File.Exists(CustomWallpaperFile) ? await File.ReadAllBytesAsync(CustomWallpaperFile) : null;
            if (!File.Exists(file))
            {
                var bytes = await WallpaperHttp.GetByteArrayAsync(wallpaper.ImageUrl);
                // Une image JPEG d'une taille plausible, rien d'autre.
                if (bytes.Length is < 20_000 or > MaxWallpaper || bytes[0] != 0xFF || bytes[1] != 0xD8) return null;
                Directory.CreateDirectory(WallpaperFolder);
                var partial = file + "." + Guid.NewGuid().ToString("N") + ".part";
                await File.WriteAllBytesAsync(partial, bytes);
                File.Move(partial, file, overwrite: true);
            }
            return await File.ReadAllBytesAsync(file);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException or UnauthorizedAccessException)
        {
            DebugLog.Write($"fond d'accueil {wallpaper.Id} indisponible : {e.Message}");
            return null;
        }
    }

    private static async Task<(byte R, byte G, byte B)> WallpaperColorAsync(byte[] bytes, (byte R, byte G, byte B) fallback)
    {
        try
        {
            using var source = new MemoryStream(bytes, writable: false).AsRandomAccessStream();
            var decoder = await BitmapDecoder.CreateAsync(source);
            const uint size = 24;
            var transform = new BitmapTransform { ScaledWidth = size, ScaledHeight = size, InterpolationMode = BitmapInterpolationMode.Fant };
            var pixels = (await decoder.GetPixelDataAsync(BitmapPixelFormat.Rgba8, BitmapAlphaMode.Ignore, transform,
                ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.ColorManageToSRgb)).DetachPixelData();
            int r = 0, g = 0, b = 0;
            for (var index = 0; index < pixels.Length; index += 4)
            {
                r += pixels[index]; g += pixels[index + 1]; b += pixels[index + 2];
            }
            var count = pixels.Length / 4;
            return count == 0 ? fallback : ((byte)(r / count), (byte)(g / count), (byte)(b / count));
        }
        catch (Exception e) when (e is IOException or ArgumentException or System.Runtime.InteropServices.COMException)
        {
            return fallback;
        }
    }
}
