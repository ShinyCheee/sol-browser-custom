using System.Text.Json;
using Browser.Core;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

/// <summary>
/// Zoom des pages : le vrai zoom du moteur, piloté par l'extension interne de Sol.
/// Le fichier zoom.json n'est pas déclaré dans web_accessible_resources : seul worker.js peut lire le jeton secret
/// aléatoire de cette exécution, ce qui empêche toute page web de forger un message de zoom ou de rafraîchissement.
/// </summary>
public static class PageZoom
{
    /// <summary>Identité fixée par la clé du manifeste : la même dans tous les profils.</summary>
    public const string ExtensionId = "joongffhgagcehjmlaeopoemilgmiabe";
    private const string Key = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsPyc9JB2w9NlGrB9/prLVZv/I26hQ07QLSFpciR+mGFCnU4kyvjNnmEQC2u5waUcFC5m8SwVdbecI4Dq0NuE0KR8mthWmlCeMCe9vfN2JCSzK0c0AYeaJHG4DsyE+TSUuPLRFxqwwCaHhbqPsf5lRPduOCkr4qhZG6Ti+jLYFJNgaJux6Tt3BKkyakyir43oaRLCwzWVGIZ9HLnNjPc7LaLXRo7I38aiQsVrEzkhg89LIILMBdXkExuTOvBpeepMrVHMlmXG0F34oeKpx4VifhIzdJbyiA3rrKqLFogi8QErQHBivLTetN2yThM6schiGFWD6tFLE70ZxEOkAAvztQIDAQAB";
    private const string Event = "sol-page-zoom";
    private static readonly string Secret = Guid.NewGuid().ToString("N");
    private static readonly object Sync = new();
    private static readonly SemaphoreSlim InstallGate = new(1, 1);

    private static string Folder => Path.Combine(AppPaths.DataDir, "zoom");

    private static string Manifest => JsonSerializer.Serialize(new
    {
        manifest_version = 3, name = "Sol", version = "1.0", key = Key,
        description = "Zoom des pages de Sol.",
        permissions = new[] { "tabs", "storage" },
        background = new { service_worker = "worker.js" },
        content_scripts = new[] { new { matches = new[] { "<all_urls>" }, js = new[] { "content.js" }, run_at = "document_start" } },
    });

    // Dans la page : relaie la demande authentifiée du navigateur pour cet onglet.
    private const string Content = $$"""
        addEventListener('{{Event}}', e => {
          e.stopImmediatePropagation();
          try {
            const data = typeof e.detail === 'string' ? JSON.parse(e.detail) : e.detail;
            if (data && typeof data.secret === 'string') chrome.runtime.sendMessage({ secret: data.secret, zoom: data.zoom });
          } catch {}
        }, true);
        """;

    private const string Worker = """
        const START = 'https://start.sol/';
        let fallback = 1, plain = [], currentSecret = '', loaded = false, lastSecretRead = 0;
        const settings = async () => {
          try {
            const read = await (await fetch(chrome.runtime.getURL('zoom.json'), { cache: 'no-store' })).json();
            if (typeof read.secret === 'string') currentSecret = read.secret;
            if (read.zoom >= 0.25 && read.zoom <= 5) fallback = read.zoom;
            plain = Array.isArray(read.plain) ? read.plain : [];
            loaded = true;
          } catch {}
        };
        const verify = async secret => {
          if (typeof secret !== 'string' || !secret) return false;
          if (!loaded) await settings();
          if (secret === currentSecret) return true;
          const now = Date.now();
          if (now - lastSecretRead < 2000) return false;
          lastSecretRead = now;
          await settings();
          return secret === currentSecret;
        };
        const own = async id => (await chrome.storage.session.get('t' + id))['t' + id];
        const isDocument = url => /\.pdf$/i.test(url.split(/[?#]/)[0]) || plain.includes(url);
        async function apply(tab, navigated) {
          try {
            const url = tab.url || tab.pendingUrl || '';
            const mine = await own(tab.id);
            if (!loaded) await settings();
            let zoom;
            if (mine != null) zoom = mine;
            else if (!url) return;
            else if (url.startsWith(START) || url.startsWith('chrome-extension://')) zoom = 1;
            else if (isDocument(url)) { if (!navigated) return; zoom = 1; }
            else zoom = fallback;
            if (Math.abs(await chrome.tabs.getZoom(tab.id) - zoom) > 0.001) await chrome.tabs.setZoom(tab.id, zoom);
          } catch {}
        }
        chrome.runtime.onInstalled.addListener(async () => { await settings(); for (const tab of await chrome.tabs.query({})) await apply(tab, true); });
        chrome.tabs.onCreated.addListener(tab => apply(tab, true));
        chrome.tabs.onUpdated.addListener((id, change, tab) => { if (change.url || change.status === 'loading') apply(tab, true); });
        chrome.tabs.onRemoved.addListener(id => chrome.storage.session.remove('t' + id));
        chrome.runtime.onMessage.addListener((message, sender) => {
          if (!sender.tab) return;
          (async () => {
            if (!await verify(message?.secret)) return;
            if (message.zoom === 'refresh') { await settings(); for (const tab of await chrome.tabs.query({})) await apply(tab, false); return; }
            const key = 't' + sender.tab.id;
            if (typeof message.zoom === 'number' && message.zoom >= 0.25 && message.zoom <= 5) await chrome.storage.session.set({ [key]: message.zoom });
            else await chrome.storage.session.remove(key);
            await apply(sender.tab, false);
          })();
        });
        """;

    private static readonly HashSet<string> s_plain = new();
    private static double s_zoom = 1;

    /// <summary>Zoom du profil. Appliqué aux onglets à leur prochaine navigation, ou tout de suite après <see cref="RefreshAsync"/>.</summary>
    public static void Set(double zoom)
    {
        lock (Sync) s_zoom = zoom;
        WriteSettings();
    }

    /// <summary>Adresse d'un document (PDF) : affichée à 100 %, le zoom y est celui du lecteur.</summary>
    public static bool KeepPlain(string url)
    {
        bool added;
        lock (Sync)
        {
            if (s_plain.Count > 200) s_plain.Clear();
            added = s_plain.Add(url);
        }
        if (added) WriteSettings();
        return added;
    }

    private static void WriteSettings()
    {
        try
        {
            string json;
            lock (Sync) json = JsonSerializer.Serialize(new { secret = Secret, zoom = s_zoom, plain = s_plain.ToArray() });
            Directory.CreateDirectory(Folder);
            WriteAtomic(Path.Combine(Folder, "zoom.json"), json);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        { DebugLog.Write("zoom : réglage non écrit : " + e.Message); }
    }

    private static void WriteAtomic(string file, string content)
    {
        var temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        File.WriteAllText(temp, content);
        File.Move(temp, file, overwrite: true);
    }

    /// <summary>Pose l'extension dans le dossier du profil et la charge dans le moteur, avant la première page.</summary>
    public static async Task InstallAsync(CoreWebView2Profile profile, double zoom)
    {
        await InstallGate.WaitAsync();
        try
        {
            Set(zoom);
            var changed = false;
            Directory.CreateDirectory(Folder);
            foreach (var (name, content) in new[] { ("manifest.json", Manifest), ("worker.js", Worker), ("content.js", Content) })
            {
                var file = Path.Combine(Folder, name);
                if (File.Exists(file) && await File.ReadAllTextAsync(file) == content) continue;
                WriteAtomic(file, content);
                changed = true;
            }
            var installed = (await profile.GetBrowserExtensionsAsync()).FirstOrDefault(e => e.Id == ExtensionId);
            if (changed || installed is null) installed = await profile.AddBrowserExtensionAsync(Folder);
            if (!installed.IsEnabled) await installed.EnableAsync(true);
            if (installed.Id != ExtensionId) DebugLog.Write($"zoom : identité inattendue ({installed.Id})");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException or ArgumentException or System.Runtime.InteropServices.COMException)
        { DebugLog.Write("zoom : extension non chargée, les pages restent à 100 % : " + e.Message); }
        finally { InstallGate.Release(); }
    }

    /// <summary>Zoom propre à cet onglet (1 pour un appareil simulé ou le lecteur flottant) ; null : celui du profil.</summary>
    public static Task TabAsync(CoreWebView2 core, double? zoom) => SendAsync(core, zoom);

    /// <summary>Le réglage vient de changer : tous les onglets le prennent maintenant. La page donnée sert de relais.</summary>
    public static Task RefreshAsync(CoreWebView2 core) => SendAsync(core, "refresh");

    private static async Task SendAsync(CoreWebView2 core, object? zoom)
    {
        var payload = JsonSerializer.Serialize(JsonSerializer.Serialize(new { secret = Secret, zoom }));
        try { await core.ExecuteScriptAsync($"dispatchEvent(new CustomEvent('{Event}', {{ detail: {payload} }}))"); }
        catch (Exception e) when (e is InvalidOperationException or System.Runtime.InteropServices.COMException) { /* vue fermée entre-temps */ }
    }
}
