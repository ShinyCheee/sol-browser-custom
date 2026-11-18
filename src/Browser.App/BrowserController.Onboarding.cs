using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    // Accueil : ce qu'il affiche au départ (réglages en cours, navigateurs trouvés sur l'ordinateur).
    private IReadOnlyList<ImportSource> _importSources = [];
    private const int ImportedHistory = 5000; // pages d'historique reprises, les plus récentes

    private void PostWelcome()
    {
        _importSources = BrowserImport.Detect(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
        _bridge.BroadcastTheme();
        _welcome.Post(JsonSerializer.Serialize(new
        {
            welcome = "state",
            first = !_settings.Onboarded,
            cloud = AppPaths.Private ? null : CloudJson(),
            name = _settings.ProfileName,
            theme = Math.Max(0, Array.IndexOf(Themes, _settings.Theme)),
            font = Math.Max(0, Array.IndexOf(Fonts, _settings.Font)),
            language = Math.Max(0, Array.IndexOf(Languages, _settings.Language)),
            engine = Math.Max(0, Array.FindIndex(Engines, e => e.Search == _settings.SearchUrlTemplate)),
            engines = Engines.Select(e => e.Name),
            pip = _settings.AutoPip,
            browsers = _importSources.Select(s => new { id = s.Id, name = s.Name, profiles = s.Profiles.Select(p => new { folder = p.Folder, name = p.Name }) }),
        }));
    }

    // Reprend les favoris, l'historique et les mots de passe d'un profil d'un autre navigateur. La lecture des fichiers se fait hors du fil
    // de l'interface ; seul un profil détecté par le navigateur lui-même est accepté.
    private async Task ImportAsync(string browser, string folder)
    {
        if (BrowserImport.ProfileDir(_importSources, browser, folder) is not { } dir) return;
        var temp = Path.Combine(AppPaths.DataDir, "import");
        IReadOnlyList<Bookmark> bookmarks = [];
        IReadOnlyList<ImportedVisit> visits = [];
        int logins = 0, locked = 0;
        string? error = null;
        try
        {
            var data = await Task.Run(() => (BrowserImport.ReadBookmarks(dir), BrowserImport.ReadHistory(dir, ImportedHistory, temp)));
            _db.Import(data.Item1, data.Item2);
            (bookmarks, visits) = data;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException)
        {
            error = T("Les favoris et l’historique n’ont pas pu être importés. Réessayez.", "Bookmarks and history could not be imported. Please retry.");
        }
        try
        {
            // Le moteur garde sa base ouverte : les mots de passe sont appliqués au prochain démarrage.
            (logins, locked) = await Task.Run(() =>
            {
                var read = PasswordImport.Read(BrowserImport.UserData(_importSources, browser)!, dir, temp);
                PasswordImport.Queue(AppPaths.PendingPasswords, read.Logins);
                return (read.Logins.Count, read.Unreadable);
            });
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or Microsoft.Data.Sqlite.SqliteException or System.Security.Cryptography.CryptographicException)
        {
            error = T("Import incomplet. Fermez le navigateur source et réessayez, ou importez ses mots de passe depuis un fichier CSV.", "Import incomplete. Close the source browser and retry, or import its passwords from a CSV file.");
        }
        _welcome.Post(JsonSerializer.Serialize(new { welcome = "imported", id = browser, folder, bookmarks = bookmarks.Count, history = visits.Count, passwords = logins, locked, error }));
        Refresh();
    }
}
