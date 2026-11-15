using System.Security.Cryptography;
using System.Text.Json;
using Browser.Core;

namespace Browser.App;

// Compte Sol et sauvegarde en ligne. Le profil est scellé sur l'appareil (voir Backup) avant de partir : le service ne
// reçoit que du chiffré. La session et l'empreinte du mot de passe du compte restent protégées pour l'utilisateur Windows.
public sealed partial class BrowserController
{
    // Adresses publiques du projet Neon : l'accès aux données dépend du compte, jamais d'un secret livré dans Sol.
    private static readonly CloudAccount Cloud = new(new HttpClient { Timeout = TimeSpan.FromMinutes(10) },
        Environment.GetEnvironmentVariable("NAVIGATEUR_CLOUD_AUTH") ?? "https://ep-plain-firefly-b84mlktb.neonauth.c-14.us-east-1.aws.neon.tech/neondb/auth",
        Environment.GetEnvironmentVariable("NAVIGATEUR_CLOUD_API") ?? "https://br-wispy-night-b89mzp5p-backup.compute.c-14.us-east-1.aws.neon.tech");
    private const int CloudKeyLength = 12; // le fichier est hors de la machine : la clé doit résister à une attaque hors ligne
    // AutoKey : la clé gardée pour la sauvegarde automatique, protégée comme le reste de ce fichier par Windows.
    private sealed record CloudSession(string Email, string Cookie, byte[] Salt, byte[] PasswordHash, string? AutoKey = null, DateTimeOffset? LastBackup = null, string? BackupId = null, string? BackupKey = null);
    private string? SavedCloudKey => _cloud?.BackupKey ?? _cloud?.AutoKey;
    private bool CloudSignedIn => _cloud is { Cookie.Length: > 0 };
    private CloudSession? _cloud;
    private bool _cloudLoaded, _cloudBusy;
    private string? _cloudError, _cloudNotice;
    private IReadOnlyList<CloudBackup> _cloudBackups = [];
    private static string CloudFile => Path.Combine(AppPaths.DataDir, "cloud-session.bin");

    private object CloudJson()
    {
        LoadCloud();
        return new
        {
            email = CloudSignedIn ? _cloud?.Email : null, busy = _cloudBusy, error = _cloudError, notice = _cloudNotice, auto = _cloud?.AutoKey is not null,
            last = _cloud?.LastBackup?.LocalDateTime.ToString("g", System.Globalization.CultureInfo.GetCultureInfo(Language.Current)),
            backups = _cloudBackups.Select(b => new { id = b.Id, device = b.Device, bytes = b.Bytes, date = b.CreatedAt.LocalDateTime.ToString("g", System.Globalization.CultureInfo.GetCultureInfo(Language.Current)) }),
        };
    }

    private void LoadCloud()
    {
        if (_cloudLoaded || AppPaths.Private) return;
        _cloudLoaded = true;
        try { if (File.Exists(CloudFile)) _cloud = JsonSerializer.Deserialize<CloudSession>(ProtectedData.Unprotect(File.ReadAllBytes(CloudFile), null, DataProtectionScope.CurrentUser)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CryptographicException or JsonException) { DebugLog.Write($"cloud.session {e.GetType().Name}"); }
    }

    private void SaveCloud()
    {
        try
        {
            if (_cloud is null) File.Delete(CloudFile);
            else
            {
                File.WriteAllBytes(CloudFile + ".tmp", ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(_cloud), null, DataProtectionScope.CurrentUser));
                File.Move(CloudFile + ".tmp", CloudFile, true);
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CryptographicException) { DebugLog.Write($"cloud.save {e.GetType().Name}"); }
    }

    private bool CloudCommand(Command c)
    {
        if (!c.Type.StartsWith("cloud.", StringComparison.Ordinal)) return false;
        if (AppPaths.Private) return true;
        LoadCloud();
        switch (c.Type)
        {
            case "cloud.sign": _ = CloudRunAsync(() => SignInCloudAsync(c.Query!.Trim(), c.Input!, c.Id == "up")); break;
            case "cloud.signout": if (_cloudBusy) break; _cloud = null; _cloudBackups = []; _cloudError = _cloudNotice = null; SaveCloud(); PostCloud(); break;
            case "cloud.refresh": if (CloudSignedIn) _ = CloudRunAsync(RefreshCloudAsync); else PostCloud(); break;
            case "cloud.backup":
                if (!CloudSignedIn || _cloudBusy) break;
                if (SavedCloudKey is { } savedKey) { _ = UploadCloudAsync(savedKey); break; }
                AskName(T("Clé de sauvegarde", "Backup key"),
                    T($"Au moins {CloudKeyLength} caractères, différente du mot de passe du compte. Sol la conserve protégée par Windows pour les prochaines sauvegardes. Gardez-en une copie pour restaurer sur un autre PC.", $"At least {CloudKeyLength} characters, different from your account password. Sol keeps it protected by Windows for future backups. Keep a copy to restore on another PC."),
                    T("Clé de sauvegarde", "Backup key"), T("Sauvegarder", "Back up"), "", "cloud.backup.key", secret: true);
                break;
            case "cloud.backup.key": if (CloudSignedIn && !_cloudBusy) _ = UploadCloudAsync(c.Title!); break;
            case "cloud.restore": _ = CloudRunAsync(() => DownloadCloudAsync(c.Id!)); break;
            case "cloud.auto" or "cloud.auto.key" or "cloud.restore.key": CloudAutoCommand(c); break;
            case "cloud.delete": _ = CloudRunAsync(async () => { await Cloud.DeleteAsync(_cloud!.Cookie, c.Id!); await RefreshCloudAsync(); }); break;
        }
        return true;
    }

    private void PostCloud()
    {
        if (_settingsOpen) _popup.Post(SettingsJson());
        if (_welcome.IsOpen) _welcome.Post(JsonSerializer.Serialize(new { welcome = "cloud", cloud = CloudJson() }));
    }

    private async Task CloudRunAsync(Func<Task> work)
    {
        if (_cloudBusy) return;
        _cloudBusy = true; _cloudError = _cloudNotice = null; PostCloud();
        try { await work(); }
        catch (CloudException e)
        {
            DebugLog.Write($"cloud.failed {e.Code}");
            _cloudError = e.Code;
            if (e.Code == "signed-out") { if (_cloud is { } saved) _cloud = saved with { Cookie = "", BackupKey = SavedCloudKey }; _cloudBackups = []; SaveCloud(); }
            if (e.Code == "key" && _cloud is { } rejected) { _cloud = rejected with { AutoKey = null, BackupKey = null }; SaveCloud(); }
        }
        catch (InvalidDataException e)
        {
            DebugLog.Write($"cloud.failed {e.GetType().Name}");
            _cloudError = e.Message.StartsWith("Le contenu de la sauvegarde dépasse", StringComparison.Ordinal)
                || e.Message.StartsWith("La sauvegarde dépasse", StringComparison.Ordinal) ? "backup-size" : "backup-invalid";
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or CryptographicException or InvalidOperationException or Microsoft.Data.Sqlite.SqliteException)
        { DebugLog.Write($"cloud.failed {e.GetType().Name} {e.Message}"); _cloudError = "server"; }
        finally { _cloudBusy = false; PostCloud(); }
    }

    private static byte[] PasswordHash(string password, byte[] salt) => Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);

    private async Task SignInCloudAsync(string email, string password, bool create)
    {
        var cookie = await Cloud.SignInAsync(email, password, create);
        var salt = RandomNumberGenerator.GetBytes(16);
        var previous = string.Equals(_cloud?.Email, email, StringComparison.OrdinalIgnoreCase) ? _cloud : null;
        _cloud = new(email, cookie, salt, PasswordHash(password, salt), previous?.AutoKey, previous?.LastBackup, previous?.BackupId,
            previous?.BackupKey ?? previous?.AutoKey);
        SaveCloud();
        await RefreshCloudAsync();
    }

    private async Task RefreshCloudAsync() { if (_cloud is { } session) _cloudBackups = await Cloud.ListAsync(session.Cookie); }

    // Le service voit passer le mot de passe du compte : le réutiliser comme clé annulerait le chiffrement.
    private string? CloudKeyProblem(string key)
    {
        if (key.Length < CloudKeyLength) return T($"La clé doit contenir au moins {CloudKeyLength} caractères.", $"The key needs at least {CloudKeyLength} characters.");
        if (_cloud is { } s && CryptographicOperations.FixedTimeEquals(PasswordHash(key, s.Salt), s.PasswordHash))
            return T("La clé doit être différente du mot de passe du compte.", "The key must differ from your account password.");
        return null;
    }

    /// <param name="quiet">Sauvegarde automatique : aucun message si tout va bien.</param>
    private async Task UploadCloudAsync(string key, bool quiet = false)
    {
        if (!CloudSignedIn || _cloudBusy) return;
        if (CloudKeyProblem(key) is { } problem) { Notice(T("Clé refusée", "Key rejected"), problem); return; }
        if (!quiet) HidePopup();
        PasswordBackupDocument? passwords = null;
        await CloudRunAsync(async () =>
        {
            var existing = await Cloud.ListAsync(_cloud!.Cookie);
            var previous = existing.Where(b => string.Equals(b.Device, Environment.MachineName, StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(b => b.Id == _cloud.BackupId).ToList();
            byte[]? previousBytes = null;
            if (previous.FirstOrDefault() is { } latest)
            {
                previousBytes = await Cloud.DownloadAsync(_cloud.Cookie, latest.Id);
            }
            var result = await SealProfileAsync(key, previousBytes);
            var sealedFile = result.File;
            passwords = result.Passwords;
            var newId = await Cloud.UploadAsync(_cloud!.Cookie, sealedFile, Environment.MachineName, replace: true);
            foreach (var old in previous.Where(b => b.Id != newId))
            {
                try { await Cloud.DeleteAsync(_cloud.Cookie, old.Id); }
                catch (CloudException) { }
            }
            if (_cloud is { } session) { _cloud = session with { LastBackup = DateTimeOffset.UtcNow, BackupId = newId, BackupKey = key }; SaveCloud(); }
            await RefreshCloudAsync();
            _cloudNotice = "saved";
        });
        if (quiet && passwords is { Unreadable: > 0 } && _cloudNotice == "saved") Notice(T("Sauvegarde automatique incomplète", "Incomplete automatic backup"), PasswordBackupSummary(passwords));
        if (quiet) { if (_cloudError is "signed-out") Notice(T("Sauvegarde automatique arrêtée", "Automatic backup stopped"), CloudErrorText("signed-out")); return; }
        if (_cloudNotice == "saved") Notice(T("Sauvegarde envoyée", "Backup sent"), T("Réglages, onglets, favoris, historique, notes, mots de passe et extensions, chiffrés sur cet appareil avec votre clé.", "Settings, tabs, bookmarks, history, notes, passwords and extensions, encrypted on this device with your key.") + " " + PasswordBackupSummary(passwords!));
        else if (_cloudError is { } error) Notice(T("Sauvegarde impossible", "Backup failed"), CloudErrorText(error));
    }

    private async Task DownloadCloudAsync(string id)
    {
        var bytes = await Cloud.DownloadAsync(_cloud!.Cookie, id);
        var folder = Path.Combine(AppPaths.DataDir, "import");
        Directory.CreateDirectory(folder);
        _restoreFile = Path.Combine(folder, $"cloud-{Guid.NewGuid():N}.solbackup");
        await File.WriteAllBytesAsync(_restoreFile, bytes);
        AskBackupKey(export: false);
    }

    private static string CloudErrorText(string code) => code switch
    {
        "signed-out" => T("Votre session a expiré. Reconnectez-vous.", "Your session expired. Sign in again."),
        "network" => T("Connexion au service impossible.", "Could not reach the service."),
        "too-large" => T("La sauvegarde dépasse 256 Mo.", "The backup exceeds 256 MB."),
        "backup-size" => T("Le profil dépasse la taille autorisée pour une sauvegarde. Votre sauvegarde existante est conservée.", "The profile exceeds the backup size limit. Your existing backup is kept."),
        "backup-invalid" => T("Les données du profil n’ont pas pu être archivées. Votre sauvegarde existante est conservée.", "The profile could not be archived. Your existing backup is kept."),
        "key" => T("La clé ne permet pas de lire la sauvegarde existante. Celle-ci a été conservée.", "The key cannot open the existing backup. That backup was kept."),
        _ => T("Le service a refusé la demande. Réessayez.", "The service rejected the request. Try again."),
    };

    private static string PasswordBackupSummary(PasswordBackupDocument passwords) =>
        T($"Mots de passe exportés : {passwords.Exported}. Illisibles et omis : {passwords.Unreadable}.",
          $"Passwords exported: {passwords.Exported}. Unreadable and omitted: {passwords.Unreadable}.")
        + (passwords.Unreadable > 0 ? T(" Exportez les entrées manquantes en CSV depuis leur navigateur puis importez-les dans Sol.", " Export the missing entries as CSV from their browser, then import them into Sol.") : "");

    private async Task<(byte[] File, PasswordBackupDocument Passwords)> SealProfileAsync(string key, byte[]? previousBackup = null)
    {
        SaveSession();
        JsonFileStore.Save(AppPaths.Settings, _settings);
        var temp = Path.Combine(AppPaths.DataDir, "import");
        Directory.CreateDirectory(temp);
        var copy = Path.Combine(temp, $"backup-{Guid.NewGuid():N}.db");
        _db.BackupTo(copy);
        return await Task.Run(() =>
        {
            try
            {
                var sessionPath = Path.Combine(AppPaths.DataDir, "tab-sessions.json");
                var sessions = File.Exists(sessionPath) ? JsonSerializer.Deserialize<List<TabSession>>(File.ReadAllBytes(sessionPath)) ?? [] : [];
                var passwords = PasswordBackup.Collect(EngineData, sessions, temp, AppPaths.PendingPasswords);
                if (previousBackup is not null)
                {
                    var previousFiles = Backup.OpenEntry(previousBackup, key, Backup.Passwords) ?? throw new CloudException("key");
                    if (previousFiles.TryGetValue(Backup.Passwords, out var prevPass))
                    {
                        try { passwords = PasswordBackup.Merge(passwords, PasswordBackup.Decode(prevPass)) with { Unreadable = passwords.Unreadable }; }
                        catch (JsonException) { }
                    }
                }
                var files = new Dictionary<string, byte[]> { ["browser.db"] = File.ReadAllBytes(copy), [Backup.Passwords] = JsonSerializer.SerializeToUtf8Bytes(passwords) };
                return (Backup.SealProfile(AppPaths.DataDir, files, key), passwords);
            }
            finally { File.Delete(copy); }
        });
    }
}
