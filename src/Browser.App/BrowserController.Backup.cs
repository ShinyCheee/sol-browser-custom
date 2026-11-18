using System.Runtime.InteropServices;
using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    // Dossier du moteur pour ce profil : sa base de mots de passe et la clé qui les chiffre.
    private static string EngineData => Path.Combine(Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER") ?? AppPaths.WebData, "EBWebView");

    private async Task<string?> PickFileAsync(string label, string extension)
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker { SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary };
        picker.FileTypeFilter.Add(extension);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(_window));
        return (await picker.PickSingleFileAsync())?.Path;
    }

    // Mots de passe exportés en CSV par un autre navigateur : pour ceux qu'il garde pour lui seul sur le disque.
    private async Task ImportCsvAsync(bool fromSettings)
    {
        if (fromSettings) HidePopup();
        if (AppPaths.Private) return;
        IReadOnlyList<ImportedLogin> logins = [];
        string? error = null;
        try
        {
            if (await PickFileAsync("CSV", ".csv") is not { } file) return;
            logins = PasswordImport.ReadCsv(await File.ReadAllTextAsync(file));
            PasswordImport.Queue(AppPaths.PendingPasswords, logins);
            if (logins.Count == 0) error = T("Aucun mot de passe trouvé. Exportez les mots de passe en CSV avec les colonnes URL, identifiant et mot de passe.", "No passwords found. Export passwords as CSV with URL, username and password columns.");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException or COMException)
        { logins = []; error = T("Le fichier n’a pas pu être importé. Vérifiez son accès et réessayez.", "The file could not be imported. Check access to the file and retry."); }
        _welcome.Post(JsonSerializer.Serialize(new { welcome = "csv", passwords = logins.Count, error }));
        if (fromSettings)
            Notice(T("Mots de passe", "Passwords"), error ?? (logins.Count > 0
                ? T($"{logins.Count} mot{(logins.Count > 1 ? "s" : "")} de passe importé{(logins.Count > 1 ? "s" : "")}. Ils seront disponibles au prochain démarrage de Sol.", $"{logins.Count} password{(logins.Count == 1 ? "" : "s")} imported. They will be available the next time Sol starts.")
                : T("Aucun mot de passe trouvé dans ce fichier.", "No password found in this file.")));
    }

    // Sauvegarde du profil dans un fichier chiffré par une clé que l'utilisateur choisit et garde : Sol ne la retient pas.
    private string? _restoreFile;

    private void AskBackupKey(bool export, bool tooShort = false)
    {
        if (AppPaths.Private) return;
        if (export)
            AskName(T("Clé de sauvegarde", "Backup key"),
                tooShort ? T($"Au moins {Backup.MinKeyLength} caractères.", $"At least {Backup.MinKeyLength} characters.")
                         : T("Choisissez une clé et gardez-la : sans elle, la sauvegarde est illisible, et Sol ne peut pas la retrouver.", "Choose a key and keep it: without it the backup cannot be read, and Sol cannot recover it."),
                T("Clé de sauvegarde", "Backup key"), T("Exporter", "Export"), "", "backup.export.key", secret: true);
        else
            AskName(T("Clé de sauvegarde", "Backup key"), T("La clé choisie au moment de l'export.", "The key chosen when the backup was exported."),
                T("Clé de sauvegarde", "Backup key"), T("Restaurer", "Restore"), "", "backup.restore", secret: true);
    }

    private async Task ExportBackupAsync(string key)
    {
        if (AppPaths.Private) return;
        if (key.Length < Backup.MinKeyLength) { AskBackupKey(export: true, tooShort: true); return; }
        HidePopup();
        var picker = new Windows.Storage.Pickers.FileSavePicker
        {
            SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.DocumentsLibrary,
            SuggestedFileName = $"Sol {DateTime.Now:yyyy-MM-dd}",
        };
        picker.FileTypeChoices.Add(T("Sauvegarde Sol", "Sol backup"), [".solbackup"]);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(_window));
        if (await picker.PickSaveFileAsync() is not { } target) return;
        try
        {
            var (sealedFile, passwords) = await SealProfileAsync(key);
            await File.WriteAllBytesAsync(target.Path, sealedFile);
            Notice(T("Sauvegarde exportée", "Backup exported"),
                T("Réglages, onglets, favoris et historique. Gardez le fichier et sa clé.", "Settings, tabs, bookmarks and history. Keep the file and its key.") + " " + PasswordBackupSummary(passwords));
        }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or System.Security.Cryptography.CryptographicException or Microsoft.Data.Sqlite.SqliteException)
        {
            Notice(T("Export impossible", "Export failed"), e.Message);
        }
    }

    private async Task PickBackupAsync()
    {
        if (AppPaths.Private) return;
        HidePopup();
        if (await PickFileAsync(T("Sauvegarde Sol", "Sol backup"), ".solbackup") is not { } file) return;
        _restoreFile = file;
        AskBackupKey(export: false);
    }

    private void RestoreBackup(string key) => _ = RestoreBackupAsync(key);

    private async Task RestoreBackupAsync(string key)
    {
        if (AppPaths.Private || _restoreFile is not { } file) return;
        Dictionary<string, byte[]>? files = null;
        try
        {
            files = await Task.Run(() =>
            {
                using var stream = File.OpenRead(file);
                if (stream.Length > Backup.MaxSealedBytes) return null;
                var bytes = new byte[checked((int)stream.Length)];
                stream.ReadExactly(bytes);
                return Backup.Open(bytes, key);
            });
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        if (files is null)
        {
            Notice(T("Restauration impossible", "Restore failed"), T("La clé est incorrecte, ou ce fichier n'est pas une sauvegarde de Sol.", "The key is wrong, or this file is not a Sol backup."));
            return;
        }
        _restoreFile = null;
        if (Path.GetFileName(file).StartsWith("cloud-", StringComparison.Ordinal)) try { File.Delete(file); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        try
        {
            await Task.Run(() => Backup.Stage(AppPaths.DataDir, files));
        }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or JsonException or System.Security.Cryptography.CryptographicException)
        {
            Notice(T("Restauration impossible", "Restore failed"), e.Message);
            return;
        }
        Notice(T("Sauvegarde prête", "Backup ready"), T("Fermez puis rouvrez Sol : la sauvegarde remplacera les réglages, onglets, favoris et historique actuels, et ajoutera ses mots de passe.", "Close and reopen Sol: the backup will replace the current settings, tabs, bookmarks and history, and add its passwords."));
    }
}
