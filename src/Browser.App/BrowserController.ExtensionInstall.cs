using System.Runtime.InteropServices;
using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    private async Task ReloadExtensionAsync(string id)
    {
        if (PrivateActive || EngineProfile is null || !ExtensionCatalog.IsId(id) || id == PageZoom.ExtensionId) return;
        await _extensionChanges.WaitAsync();
        try
        {
            var state = await SharedExtensions.SnapshotAsync();
            if (!state.TryGetValue(id, out var enabled) || enabled is null) return;
            ExtensionPopup?.Hide();
            try { ExtensionCatalog.RefreshFromSource(ExtensionFolder(id)); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or ArgumentException)
            { DebugLog.Write($"extension {id} : rafraîchissement depuis la source impossible : {e.Message}"); }
            await _pages.SyncExtensionsAsync(reloadId: id);
            await RefreshExtensionsAsync();
        }
        catch (Exception e) when (e is InvalidOperationException or ArgumentException or COMException)
        { Notice(T("Extension indisponible", "Extension unavailable"), e.Message); }
        finally { _extensionChanges.Release(); }
    }

    /// <param name="quiet">Mise à jour en arrière-plan : un échec est noté au journal, sans déranger.</param>
    private async Task<bool> InstallExtensionAsync(string source, string? knownId, bool quiet = false)
    {
        if (PrivateActive || EngineProfile is not { } profile) return false;
        await _extensionChanges.WaitAsync();
        string? backup = null, destination = null, trial = null;
        var originalSource = knownId is null ? source : null;
        var wasEnabled = true;
        try
        {
            var id = knownId;
            if (id is null)
            {
                trial = ExtensionCatalog.CopyTo(source, Path.Combine(ExtensionsDir, "ajout"));
                ExtensionCatalog.EnsureKey(trial);
                var loaded = await profile.AddBrowserExtensionAsync(trial);
                id = loaded.Id;
                await loaded.RemoveAsync();
                source = trial;
            }
            var folder = Path.Combine(ExtensionsDir, id);
            destination = folder;
            wasEnabled = (await profile.GetBrowserExtensionsAsync()).FirstOrDefault(e => e.Id == id)?.IsEnabled ?? true;
            if (Directory.Exists(folder) && !string.Equals(Path.GetFullPath(source), Path.GetFullPath(folder), StringComparison.OrdinalIgnoreCase))
            {
                backup = folder + "-previous-" + Guid.NewGuid().ToString("N");
                ExtensionCatalog.CopyTo(folder, backup);
            }
            if (!string.Equals(Path.GetFullPath(source), Path.GetFullPath(folder), StringComparison.OrdinalIgnoreCase)) ExtensionCatalog.CopyTo(source, folder);
            if (originalSource is not null) ExtensionCatalog.SaveSource(folder, originalSource);
            ExtensionShim.Apply(folder);
            var installed = await profile.AddBrowserExtensionAsync(folder);
            if (installed.Id != id)
            {
                await installed.RemoveAsync();
                throw new InvalidOperationException("L’identité de l’extension a changé. Installez sa version signée depuis le store pour préserver son accès natif.");
            }
            await installed.EnableAsync(wasEnabled);
            await SharedExtensions.SetAsync(id, wasEnabled);
            await _pages.SyncExtensionsAsync(reloadId: id);
            _pages.ApplySettings();
            await RefreshExtensionsAsync();
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or JsonException or COMException)
        {
            if (backup is not null && destination is not null)
            {
                try
                {
                    ExtensionCatalog.CopyTo(backup, destination);
                    await (await profile.AddBrowserExtensionAsync(destination)).EnableAsync(wasEnabled);
                }
                catch (Exception restore) when (restore is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException or COMException)
                { DebugLog.Write("extension : restauration incomplète, copie conservée : " + restore.Message); backup = null; }
            }
            if (quiet) DebugLog.Write("extension : mise à jour refusée : " + e.Message);
            else Notice(T("Extension refusée", "Extension rejected"), T($"Le moteur n'a pas pu charger cette extension : {e.Message}", $"The engine could not load this extension: {e.Message}"));
            return false;
        }
        finally
        {
            try { if (trial is not null && Directory.Exists(trial)) Directory.Delete(trial, true); }
            catch (Exception cleanup) when (cleanup is IOException or UnauthorizedAccessException) { }
            try { if (backup is not null && Directory.Exists(backup)) Directory.Delete(backup, true); }
            catch (Exception cleanup) when (cleanup is IOException or UnauthorizedAccessException) { DebugLog.Write("extension ancienne copie : " + cleanup.Message); }
            _extensionChanges.Release();
        }
    }

    private Task AddExtensionAsync(string id) =>
        _extensionOffers.TryGetValue(id, out var offer) ? InstallExtensionAsync(offer.Folder, offer.Id) : Task.CompletedTask;

    private async Task AddExtensionFolderAsync()
    {
        var picker = new Windows.Storage.Pickers.FolderPicker { SuggestedStartLocation = Windows.Storage.Pickers.PickerLocationId.Downloads };
        picker.FileTypeFilter.Add("*");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(_window));
        if (await picker.PickSingleFolderAsync() is not { } folder) return;
        if (ExtensionCatalog.Read(folder.Path, "") is null)
        {
            Notice(T("Ce n'est pas une extension", "Not an extension"), T("Ce dossier ne contient pas de fichier manifest.json d'extension.", "This folder has no extension manifest.json file."));
            return;
        }
        await InstallExtensionAsync(folder.Path, knownId: null);
    }

    private async Task ChangeExtensionAsync(string id, bool remove)
    {
        if (PrivateActive || EngineProfile is null || !ExtensionCatalog.IsId(id) || id == PageZoom.ExtensionId) return;
        await _extensionChanges.WaitAsync();
        try
        {
            var state = await SharedExtensions.SnapshotAsync();
            if (!state.TryGetValue(id, out var enabled) || enabled is null) return;
            await SharedExtensions.SetAsync(id, remove ? null : !enabled.Value);
            await _pages.SyncExtensionsAsync(reloadId: !remove && !enabled.Value ? id : null);
            ExtensionPopup?.Hide();
            _pages.ApplySettings();
            await RefreshExtensionsAsync();
        }
        catch (Exception e) when (e is InvalidOperationException or COMException or ArgumentException)
        { Notice(T("Extension indisponible", "Extension unavailable"), e.Message); }
        finally { _extensionChanges.Release(); }
    }
}
