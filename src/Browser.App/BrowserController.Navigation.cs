using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    private Tab OpenLink(string source, string url, bool activate = true)
    {
        var tab = _tabs.Tabs.FirstOrDefault(t => t.Id == source);
        // Un lien vers un autre site repart de la session actuelle ; une connexion doit garder celle qui l'a demandée.
        var session = tab is { SessionId.Length: > 0 } && (_sessions.Belongs(tab.SessionId, url) || TabSessions.IsSignIn(url)) ? tab.SessionId : "";
        var linked = Open(url, activate: activate, sessionId: session, isPrivate: tab?.Private);
        return KeepInSourceGroup(linked, tab);
    }

    // Session neuve : ses connexions de départ sont copiées avant que son premier onglet ne s'ouvre.
    private async Task StartSessionAsync(string tabId, string sessionId)
    {
        await _pages.SeedSessionAsync(tabId, sessionId);
        ChangeSession(tabId, sessionId);
    }

    private void ChangeSession(string tabId, string sessionId)
    {
        if (_tabs.Tabs.FirstOrDefault(t => t.Id == tabId) is not { } tab || tab.Private || sessionId == _deletingSession
            || sessionId.Length > 0 && _sessions.Resolve(sessionId).Length == 0) return;
        if (tab.SessionId == sessionId) { HidePopup(); return; }
        if (_downloads.Any(d => d.TabId == tabId && DownloadPending(d.Id, d.Op)))
        { Notice(T("Téléchargement en cours", "Download in progress"), T("Attendez sa fin avant de changer la session de cet onglet.", "Wait for it to finish before changing this tab's session.")); return; }
        HidePopup(); ExtensionPopup?.Hide();
        _network.Forget(tabId); if (_network.Shown == tabId) _network.Shown = null;
        _designTabs.Remove(tabId); _translationOriginals.Remove(tabId);
        _bridge.ForgetTab(tabId);
        var asleep = _pages.IsAsleep(tabId);
        _pages.Remove(tabId);
        if (_tabs.SetSession(tabId, sessionId) is { } changed)
        { if (asleep) _pages.AddAsleep(changed); else _pages.Add(changed); }
        _pinnedExtensions = []; _pinsInitialized = false; _pinProfileName = null;
        Refresh();
    }

    // Adresse saisie : un autre site quitte la session de l'onglet. Les redirections et connexions, elles, y restent.
    private void GoTo(string id, string url)
    {
        if (_tabs.Tabs.FirstOrDefault(t => t.Id == id) is { SessionId.Length: > 0 } tab && TabSessions.SiteOf(url) is not null
            && !_sessions.Belongs(tab.SessionId, url) && !TabSessions.IsSignIn(url)) ChangeSession(id, "");
        _pages.Navigate(id, url);
    }

    private void DetachSession(string sessionId)
    {
        if (_deletingSession is not null || _sessions.Resolve(sessionId).Length == 0) return;
        var menuTab = _sessionMenuTab;
        foreach (var tab in _tabs.Tabs.Where(t => t.SessionId == sessionId).ToList())
        {
            if (_downloads.Any(d => d.TabId == tab.Id && DownloadPending(d.Id, d.Op))) continue;
            _network.Forget(tab.Id); if (_network.Shown == tab.Id) _network.Shown = null;
            _designTabs.Remove(tab.Id); _translationOriginals.Remove(tab.Id);
            _bridge.ForgetTab(tab.Id);
            var visible = tab.Id == _tabs.ActiveId || tab.Id == _split.SecondaryId;
            var asleep = _pages.IsAsleep(tab.Id) || (!visible && _settings.MemorySaver);
            _pages.Remove(tab.Id);
            if (_tabs.SetSession(tab.Id, "") is { } changed)
            { if (asleep) _pages.AddAsleep(changed); else _pages.Add(changed); }
        }
        _pinnedExtensions = []; _pinsInitialized = false; _pinProfileName = null;
        if (menuTab is not null) { _sessionMenuTab = menuTab; _popup.Post(SessionsJson(menuTab)); }
        Refresh();
    }

    private async Task DeleteSessionAsync(string sessionId)
    {
        if (_deletingSession is not null || _sessions.Resolve(sessionId).Length == 0 || _tabs.Tabs.Any(t => t.SessionId == sessionId)) return;
        _deletingSession = sessionId;
        if (_sessionMenuTab is { } before) _popup.Post(SessionsJson(before));
        var deleted = await _pages.DeleteSessionAsync(sessionId);
        if (deleted)
        {
            _sessions.Delete(sessionId); _tabs.ForgetSession(sessionId);
            var permissions = Path.Combine(AppPaths.DataDir, "session-permissions", sessionId + ".json");
            _sessionPermissions.Remove(sessionId);
            try { File.Delete(permissions); File.Delete(permissions + ".bak"); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
        _deletingSession = null;
        if (!deleted) Notice(T("Suppression impossible", "Cannot delete session"), T("Le moteur n’a pas pu supprimer la session. Réessayez après le redémarrage de Sol.", "The engine could not delete the session. Retry after restarting Sol."));
        else if (_sessionMenuTab is { } current) _popup.Post(SessionsJson(current));
        Refresh();
    }

    private bool PrivateActive => AppPaths.Private || _tabs.Tabs.Any(t => t.Id == _tabs.ActiveId && t.Private);

    private Tab Open(string url, bool activate = true, bool pinned = false, bool asleep = false, string? sessionId = null, bool? isPrivate = null)
    {
        var privateTab = AppPaths.Private || (isPrivate ?? PrivateActive);
        var inherited = _tabs.Tabs.FirstOrDefault(t => t.Id == _tabs.ActiveId)?.SessionId ?? "";
        var session = privateTab ? "" : sessionId ?? (_sessions.Belongs(inherited, url) ? inherited : "");
        // Une identité manquante ne doit jamais charger un site avec les connexions de la session principale.
        if (session.Length > 0 && (_sessions.Resolve(session).Length == 0 || session == _deletingSession))
        { url = Settings.DefaultHomePage; session = ""; }
        var tab = _tabs.Open(url, activate, pinned, _sessions.Resolve(session), isPrivate: privateTab);
        if (asleep) _pages.AddAsleep(tab);
        else _pages.Add(tab);
        return tab;
    }

    // Le moteur entier est mort (mise à jour de WebView2, plantage) : aucune vue ne peut revivre dans ce processus.
    private bool _restarting;
    private void RestartAfterEngineLoss()
    {
        if (_restarting || _closingWindow) return;
        _restarting = true;
        DebugLog.Write("engine.lost");
        _window.DispatcherQueue.TryEnqueue(() =>
        {
            var uptime = DateTime.Now - System.Diagnostics.Process.GetCurrentProcess().StartTime;
            // Un moteur qui meurt dès le démarrage ne doit pas relancer Sol en boucle.
            if (uptime > TimeSpan.FromSeconds(30)) Relaunch(); else _window.Close();
        });
    }

    /// <summary>Ferme cette fenêtre et rouvre Sol sur le même profil, une fois celle-ci partie.</summary>
    private void Relaunch()
    {
        FlushSessionSave();
        if (!AppPaths.Private && Environment.ProcessPath is { } exe)
        {
            var start = new System.Diagnostics.ProcessStartInfo(exe, $"--profile={AppPaths.Profile} --after={Environment.ProcessId}") { UseShellExecute = false };
            foreach (var (name, value) in App.LaunchEnvironment) start.Environment[name] = value;
            try { System.Diagnostics.Process.Start(start); }
            catch (System.ComponentModel.Win32Exception) { DebugLog.Write("sol.restart.failed"); }
        }
        _window.Close();
    }

    private void Close(string id)
    {
        _designTabs.Remove(id);
        var wasActive = _tabs.ActiveId == id;
        if (_asking is not null && wasActive) HidePopup();
        var splitPartner = _split.Contains(id) ? (_split.PrimaryId == id ? _split.SecondaryId : _split.PrimaryId) : null;
        var next = wasActive
            ? TabCloseSelection.NextActive(_tabs.Tabs, _tabs.Groups, _recentTabs, id, _tabs.ActiveId, _pages.IsAsleep, _shortcutTabs.ContainsValue, splitPartner)
            : _tabs.ActiveId;

        // Fermer un onglet épinglé, ou rangé dans un groupe, ferme sa page, pas son emplacement : il reste à sa place,
        // déchargé, et se recharge quand on y revient. Pour le retirer pour de bon : le fermer une seconde fois quand il
        // est dans un groupe (il est alors déjà déchargé), ou « Détacher l'onglet » puis fermer quand il est épinglé.
        if (_tabs.Tabs.FirstOrDefault(t => t.Id == id) is { Private: false } kept && !_shortcutTabs.ContainsValue(id)
            && (kept.Pinned || (kept.GroupId is not null && !_pages.IsAsleep(id))))
        {
            _recentTabs.Remove(id);
            if (wasActive)
            {
                if (next is not null) Activate(next);
                else Open(_settings.HomePage, isPrivate: AppPaths.Private);
            }
            // Fermer la vue d'origine interromprait son téléchargement : elle reste masquée jusqu'à sa fin.
            if (_downloads.Any(d => d.TabId == id && DownloadPending(d.Id, d.Op))) return;
            _pages.Remove(id);
            _pages.AddAsleep(kept);
            _restored.Add(id); // son rechargement ne sera pas une nouvelle visite
            _split.OnTabClosed(id);
            _network.Forget(id);
            _bridge.ForgetTab(id);
            return;
        }
        if (!_tabs.Close(id)) return;
        _recentTabs.Remove(id);
        _restored.Remove(id);
        if (!_downloads.Any(d => d.TabId == id && DownloadPending(d.Id, d.Op))) _pages.Remove(id);
        _bridge.ForgetTab(id);
        if (!AppPaths.Private && !_tabs.Tabs.Any(t => t.Private))
        {
            _privatePermissions.Clear();
            PurgeFinishedPrivateDownloads();
        }
        _favicons.Remove(id);
        _translationOriginals.Remove(id);
        _split.OnTabClosed(id);
        _network.Forget(id);
        foreach (var shortcut in _shortcutTabs.Where(p => p.Value == id).Select(p => p.Key).ToList()) _shortcutTabs.Remove(shortcut);
        if (wasActive)
        {
            if (next is not null) Activate(next);
            else Open(_settings.HomePage, isPrivate: AppPaths.Private);
        }
        else if (_tabs.Tabs.Count == 0) Open(_settings.HomePage, isPrivate: AppPaths.Private);
    }

    // Onglet vide ouvert seulement pour remplir la moitié droite d'une vue scindée.
    private string? _splitBlankTab;

    private void CloseSplit()
    {
        var blank = _splitBlankTab;
        var primary = _split.PrimaryId;
        _splitBlankTab = null;
        _split.Close();
        // Resté vide : il n'a servi à rien, il repart avec la vue scindée.
        if (blank is not null && _tabs.Tabs.Count > 1 && _tabs.Tabs.FirstOrDefault(t => t.Id == blank) is { } tab
            && (tab.Url is "about:blank" or "" || tab.Url == Settings.DefaultHomePage))
        {
            if (_tabs.ActiveId == blank && primary is not null && primary != blank && _tabs.Tabs.Any(t => t.Id == primary))
                Activate(primary);
            Close(blank);
        }
    }

    // Scinde l'onglet actif avec l'onglet donné, ou avec un nouvel onglet si aucun n'est donné.
    private void Split(string? otherId)
    {
        if (_tabs.ActiveId is not { } active) return;
        if (otherId is not null && (otherId == active || _tabs.Tabs.All(t => t.Id != otherId))) return;
        var other = otherId ?? Open(Settings.DefaultHomePage, activate: false).Id;
        _splitBlankTab = otherId is null ? other : null;

        _split.Open(active, other);
        KeepPairAdjacent();
    }

    // Les deux onglets d'une vue scindée restent voisins dans la barre d'onglets, le second juste après le premier.
    private void KeepPairAdjacent()
    {
        if (!_split.IsSplit) return;
        var tabs = _tabs.Tabs.ToList();
        int p = tabs.FindIndex(t => t.Id == _split.PrimaryId), s = tabs.FindIndex(t => t.Id == _split.SecondaryId);
        if (s != p + 1) _tabs.Move(_split.SecondaryId!, s > p ? p + 1 : p);
        _tabs.MatchGroup(_split.SecondaryId!, _split.PrimaryId!);
    }

    private void PostFavicon(string id) =>
        _bridge.Post(JsonSerializer.Serialize(new { @event = "favicon", id, data = _favicons.GetValueOrDefault(id) }));
}
