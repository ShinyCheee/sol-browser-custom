using System.Runtime.InteropServices;
using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    private async void ShowExtension(ExtensionInfo extension, double right, double top, bool inspect = false)
    {
        await _extensionChanges.WaitAsync();
        try
        {
            if (PrivateActive || _tabs.ActiveId is not { } tabId || _pages.CoreOf(tabId) is not { } core) return;
            var profile = core.Profile;
            var state = await SharedExtensions.SnapshotAsync();
            if (!state.TryGetValue(extension.Id, out var enabled) || enabled != true) return;
            if (!(await profile.GetBrowserExtensionsAsync()).Any(e => e.Id == extension.Id && e.IsEnabled))
            { ExtensionActionUnavailable(); return; }
            if (_tabs.ActiveId != tabId || _pages.CoreOf(tabId) != core) return;
            var marker = ExtensionAction.Marker(extension.Folder);
            if (!inspect && (marker is null || !await _pages.InvokeExtensionActionAsync(tabId, marker)))
            { ExtensionActionUnavailable(); return; }
            if (_tabs.ActiveId != tabId || _pages.CoreOf(tabId) != core) return;
            // Les réglages ne remplacent pas l'action du bouton d'une extension, sauf en inspection développeur sans popup.
            var target = extension.Popup ?? extension.SidePanel ?? (inspect ? (extension.Options ?? "manifest.json") : null);
            if (target is { Length: > 0 } page && ExtensionPopup is { } host)
                await host.ShowAsync($"chrome-extension://{extension.Id}/{page.TrimStart('/')}", right, top,
                    profile.ProfileName, marker ?? "", panel: extension.Popup is null, inspect: inspect);
        }
        catch (Exception error) when (error is InvalidOperationException or COMException or ArgumentException
            or IOException or UnauthorizedAccessException or TimeoutException)
        {
            DebugLog.Write($"extension {extension.Id} : ouverture impossible : {error.Message}");
            ExtensionActionUnavailable();
        }
        finally { _extensionChanges.Release(); }
    }

    private void ExtensionActionUnavailable() => Notice(T("Extension indisponible", "Extension unavailable"),
        T("Le moteur n’a pas pu ouvrir cette extension. Rechargez-la dans le gestionnaire d’extensions, puis réessayez.",
            "The engine could not open this extension. Reload it in the extension manager, then try again."));
}
