using System.Runtime.InteropServices;
using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    private static string? StoreExtension(string url)
    {
        try { return ExtensionPackage.StoreId(url); }
        catch (ArgumentException) { return null; }
    }

    // Récupère le paquet signé d'une extension du store et le déballe dans un dossier provisoire, que l'appelant supprime.
    private static async Task<ExtensionInfo> DownloadStoreExtensionAsync(string id, string staging, bool edge = false)
    {
        var version = (await AdBlock.EnvironmentAsync()).BrowserVersionString.Split(' ')[0];
        using var client = new System.Net.Http.HttpClient { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        using var response = await client.GetAsync(ExtensionPackage.DownloadUri(id, version, edge), System.Net.Http.HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        if (response.StatusCode == System.Net.HttpStatusCode.NoContent)
            throw new InvalidDataException(T("Le store ne fournit pas cette extension (retirée, payante ou réservée).", "The store does not provide this extension (removed, paid or restricted)."));
        response.EnsureSuccessStatusCode();
        Directory.CreateDirectory(Path.GetDirectoryName(staging)!);
        var packagePath = staging + ".crx";
        try
        {
            await using (var package = new FileStream(packagePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, useAsync: true))
            {
                await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
                var buffer = new byte[65536];
                while (true)
                {
                    timeout.CancelAfter(TimeSpan.FromSeconds(60));
                    var count = await stream.ReadAsync(buffer, timeout.Token);
                    if (count == 0) break;
                    await package.WriteAsync(buffer.AsMemory(0, count), timeout.Token);
                }
            }
            await Task.Run(() =>
            {
                using var package = File.OpenRead(packagePath);
                ExtensionPackage.Extract(package, id, staging);
            });
        }
        finally { if (File.Exists(packagePath)) File.Delete(packagePath); }
        return ExtensionCatalog.Read(staging, id)!;
    }

    private Task InstallStoreExtensionAsync(string input)
    {
        if (StoreExtension(input) is { } id) return OfferStoreExtensionAsync(id, ExtensionPackage.IsEdgeStore(input));
        Notice(T("Installation impossible", "Installation failed"), T("Ouvrez la fiche d’une extension sur le Chrome Web Store ou Microsoft Edge Add-ons.", "Open an extension page on the Chrome Web Store or Microsoft Edge Add-ons."));
        return Task.CompletedTask;
    }

    // Télécharge l'extension, puis demande l'accord de l'utilisateur en lui montrant les accès qu'elle demande.
    private async Task OfferStoreExtensionAsync(string id, bool edge = false)
    {
        if (_installingExtension || PrivateActive || EngineProfile is not { } profile) return;
        _installingExtension = true;
        var staging = Path.Combine(ExtensionsDir, "store-" + Guid.NewGuid().ToString("N"));
        try
        {
            Notice(T("Téléchargement de l’extension", "Downloading extension"), T("Le paquet signé est récupéré depuis le store…", "Fetching the signed package from the store…"));
            var offered = await DownloadStoreExtensionAsync(id, staging, edge);
            if (_closingWindow || EngineProfile?.ProfileName != profile.ProfileName) return;
            HidePopup();
            _pendingExtension = offered;
            _popup.ShowCentered(440, JsonSerializer.Serialize(new
            {
                popup = "extension-confirm", id, name = offered.Name, version = offered.Version, icon = ExtensionCatalog.Icon(staging),
                update = _installedExtensions.Contains(id),
                access = ExtensionPermissions.Describe(offered.Permissions, Language.Current == "fr"),
            }));
        }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or ArgumentException or System.Net.Http.HttpRequestException or TaskCanceledException
            or System.Security.Cryptography.CryptographicException or JsonException or InvalidOperationException or OverflowException or OperationCanceledException)
        { Notice(T("Installation impossible", "Installation failed"), e is System.Net.Http.HttpRequestException or OperationCanceledException ? T("Le store ne répond pas. Vérifiez la connexion, puis réessayez.", "The store is not responding. Check the connection, then try again.") : e.Message); }
        finally
        {
            _installingExtension = false;
            try { if (_pendingExtension?.Folder != staging && Directory.Exists(staging)) Directory.Delete(staging, true); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { DebugLog.Write("extension temporaire : " + e.Message); }
        }
    }

    private async Task ConfirmStoreExtensionAsync(string id)
    {
        if (_pendingExtension is not { } pending || pending.Id != id) return;
        _pendingExtension = null;
        try
        {
            if (!await InstallExtensionAsync(pending.Folder, id)) return;
            _extensionUpdates.Remove(id);
            await OpenExtensionsAsync();
        }
        finally
        {
            try { if (Directory.Exists(pending.Folder)) Directory.Delete(pending.Folder, true); }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { DebugLog.Write("extension temporaire : " + e.Message); }
        }
    }

    // « 4.9 » et « 4.9.0.0 » sont la même version.
    private static Version Full(Version v) => new(v.Major, v.Minor, Math.Max(v.Build, 0), Math.Max(v.Revision, 0));

    // Au démarrage, une fois les pages lancées : au plus une recherche par demi-journée.
    private async Task UpdateExtensionsLaterAsync()
    {
        await Task.Delay(TimeSpan.FromSeconds(40));
        if (!_closingWindow && DateTime.UtcNow - _settings.ExtensionsChecked > TimeSpan.FromHours(12)) await UpdateExtensionsAsync(manual: false);
    }

    private async Task UpdateExtensionsAsync(bool manual)
    {
        if (PrivateActive || _extensionCheck == "checking" || EngineProfile is not { } profile) return;
        async Task ShowAsync(string state) { _extensionCheck = state; if (_extensionsOpen && !_closingWindow) _popup.Post(await ExtensionsJsonAsync()); }
        await ShowAsync("checking");
        var updated = 0;
        try
        {
            var mine = (await profile.GetBrowserExtensionsAsync()).Where(e => e.Id != PageZoom.ExtensionId)
                .Select(e => ExtensionCatalog.Read(ExtensionFolder(e.Id), e.Id)).OfType<ExtensionInfo>().Where(e => e.Store).ToList();
            if (mine.Count > 0)
            {
                var engine = (await AdBlock.EnvironmentAsync()).BrowserVersionString.Split(' ')[0];
                using var client = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(30) };
                foreach (var group in mine.GroupBy(e => ExtensionCatalog.IsEdgeStore(e.Folder)))
                {
                    var latest = ExtensionPackage.ParseUpdates(await client.GetStringAsync(ExtensionPackage.UpdateCheckUri(group.Select(e => e.Id), engine, group.Key)));
                    foreach (var current in group)
                    {
                        if (!latest.TryGetValue(current.Id, out var version) || !Version.TryParse(current.Version, out var have) || Full(version) <= Full(have)) continue;
                        var staging = Path.Combine(ExtensionsDir, "store-" + Guid.NewGuid().ToString("N"));
                        try
                        {
                            var next = await DownloadStoreExtensionAsync(current.Id, staging, group.Key);
                            if (_closingWindow || EngineProfile?.ProfileName != profile.ProfileName) { await ShowAsync(""); return; }
                            var before = ExtensionPermissions.Describe(current.Permissions, french: true);
                            if (ExtensionPermissions.Describe(next.Permissions, french: true).Except(before).Any()) _extensionUpdates[current.Id] = next.Version;
                            else if (await InstallExtensionAsync(staging, current.Id, quiet: true)) { _extensionUpdates.Remove(current.Id); updated++; }
                        }
                        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException or ArgumentException or System.Net.Http.HttpRequestException
                            or System.Security.Cryptography.CryptographicException or JsonException or InvalidOperationException or OverflowException or OperationCanceledException)
                        { DebugLog.Write($"extension {current.Id} : mise à jour impossible : {e.Message}"); }
                        finally
                        {
                            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); }
                            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { DebugLog.Write("extension temporaire : " + e.Message); }
                        }
                    }
                }
            }
            _settings.ExtensionsChecked = DateTime.UtcNow;
            JsonFileStore.Save(AppPaths.Settings, _settings);
            await ShowAsync(updated > 0 ? "updated" : "current");
        }
        catch (Exception e) when (e is System.Net.Http.HttpRequestException or OperationCanceledException or ArgumentException
            or InvalidOperationException or COMException or JsonException or FormatException or System.Xml.XmlException)
        {
            DebugLog.Write("extensions : recherche de mises à jour impossible : " + e.Message);
            await ShowAsync(manual ? "failed" : "");
        }
        finally
        {
            if (_extensionCheck == "checking") _extensionCheck = "";
        }
    }
}
