using System.Runtime.InteropServices;
using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    // Fenêtre d'édition d'un groupe : nom, couleur libre, icône. Sert aussi à en créer un autour d'un onglet.
    private (string? TabId, TabGroup? Group)? _groupEditing;
    private void EditGroup(string? tabId, TabGroup? group)
    {
        var members = group is null ? GroupingTabs(tabId ?? "").Select(t => t.Id).ToArray() : [];
        HidePopup();
        _groupCreationTabs = members;
        _groupEditing = (tabId, group); _groupSuggestion = null;
        _popup.ShowCentered(340, GroupEditJson(), top: 64);
    }

    private string GroupEditJson()
    {
        var (tabId, group) = _groupEditing ?? (null, null);
        return JsonSerializer.Serialize(new
        {
            popup = "group-edit",
            create = group is null,
            count = group is null ? _groupCreationTabs.Length : _tabs.Tabs.Count(t => t.GroupId == group.Id),
            id = group?.Id ?? tabId,
            name = group?.Name ?? "",
            color = group?.Color ?? TabManager.GroupColors[_tabs.Groups.Count % TabManager.GroupColors.Count],
            icon = group?.Icon ?? "",
            presets = TabManager.GroupColors,
            ai = AiReady && !PrivateActive && (group?.Id ?? tabId) is { } aiId && GroupAiTabs(aiId).Count > 0,
            suggesting = (group?.Id ?? tabId) is { } busyId && _groupSuggesting == busyId,
            suggestion = _groupSuggestion is { } s ? new { name = s.Name, color = s.Color, icon = s.Icon } : null,
        });
    }

    private void PublishGroupEditor() { if (_groupEditing is not null && !_closingWindow) _popup.Post(GroupEditJson()); }

    // Action à lancer une fois le menu refermé (ouvrir une saisie depuis un menu, par exemple).
    private Action? _afterMenu;

    // Fenêtre de saisie d'un nom, au milieu de la zone des pages. La réponse revient sous la forme d'une commande.
    private void AskName(string title, string hint, string placeholder, string submit, string value, string command, string? id = null, bool secret = false)
    {
        HidePopup();
        _popup.ShowCentered(340, JsonSerializer.Serialize(new { popup = "prompt", title, hint, placeholder, submit, value, command, id, secret }));
    }

    private void Notice(string title, string hint)
    {
        HidePopup();
        _popup.ShowCentered(340, JsonSerializer.Serialize(new { popup = "notice", title, hint }));
    }

    private async Task ToggleDesignAsync(string id)
    {
        if (_pages.CoreOf(id) is not { } core || !IsWeb(core.Source) || core.Source.StartsWith("https://start.sol/") || _pages.IsPdf(id)) return;
        HidePopup();
        var source = core.Source;
        try
        {
            _designScript ??= File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "inject", "design.js"));
            var result = await core.ExecuteScriptAsync("(() => { const designOptions=" + JsonSerializer.Serialize(new { en = Language.Current == "en" }) + ";return (\n" + _designScript + "\n);})()");
            if (core.Source != source) return;
            if (result == "true") { _designTabs.Add(id); await UpdateDesignThemeAsync(id); }
            else _designTabs.Remove(id);
        }
        catch (Exception e) when (e is IOException or InvalidOperationException or COMException)
        { Notice(T("Inspection indisponible", "Inspection unavailable"), T("Réessayez après le chargement de la page.", "Try again after the page has loaded.")); }
    }

    private async Task UpdateDesignThemeAsync(string id)
    {
        if (_readerTheme is null || _pages.CoreOf(id) is not { } core) return;
        try
        {
            await core.ExecuteScriptAsync("document.getElementById('sol-design-view')?.solTheme?.(" + _readerTheme + "," + JsonSerializer.Serialize(_settings.UiFactor / _settings.PageZoom) + ")");
        }
        catch (Exception e) when (e is InvalidOperationException or COMException) { /* document replaced */ }
    }

    private async Task EndDesignOnNavigationAsync(string id)
    {
        if (_pages.CoreOf(id) is not { } core) return;
        try { await core.ExecuteScriptAsync("(() => {const h=document.getElementById('sol-design-view');if(h?.solSource!==location.href)h?.solClose?.();})()"); }
        catch (Exception e) when (e is InvalidOperationException or COMException) { /* document replaced */ }
    }

    private async Task ToggleReaderAsync(string id)
    {
        if (!_readerBusy.Add(id)) return;
        try
        {
            if (_pages.CoreOf(id) is not { } core || !IsWeb(core.Source) || core.Source.StartsWith("https://start.sol/") || _pages.IsPdf(id)) return;
            var source = core.Source;
            _readerScript ??= File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "inject", "Readability.js"))
                + "\nreturn (\n" + File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "inject", "reader.js")) + "\n);";
            var options = JsonSerializer.Serialize(new { en = Language.Current == "en" });
            var result = await core.ExecuteScriptAsync("(() => { const readerOptions = " + options + ";" + _readerScript + "; })()");
            if (core.Source != source) return;
            if (result == "true") _reading.Add(id);
            else _reading.Remove(id);
            if (result is not ("true" or "false")) Notice(T("Mode lecteur indisponible", "Reader mode unavailable"), T("Cette page ne contient pas d’article lisible, ou son contenu est trop volumineux.", "This page has no readable article, or its content is too large."));
            Refresh();
            if (result == "true") await UpdateReaderThemeAsync(id);
        }
        catch (Exception e) when (e is IOException or InvalidOperationException or COMException)
        { Notice(T("Lecture impossible", "Could not open reader"), T("Réessayez après le chargement de la page.", "Try again after the page has loaded.")); }
        finally { _readerBusy.Remove(id); }
    }

    private async Task UpdateReaderThemeAsync(string id)
    {
        if (_readerTheme is null || _pages.CoreOf(id) is not { } core) return;
        try
        {
            await core.ExecuteScriptAsync("(() => { const t=" + _readerTheme + "; const h=document.getElementById('sol-reader-view'); if(!h)return; const dark=t.mode==='dark'||(t.mode==='system'?t.systemDark:t.mode==='light'?false:t.dark); h.style.setProperty('--bg',dark?'#121214':'#eef0e2');h.style.setProperty('--fg',dark?'#ececef':'#171719');if(t.accent)h.style.setProperty('--accent',t.accent);h.style.colorScheme=dark?'dark':'light'; })()");
        }
        catch (Exception e) when (e is InvalidOperationException or COMException) { /* navigation replaced the document */ }
    }

    private async Task ReaderSpeechAsync(string id, bool stop)
    {
        if (_pages.CoreOf(id) is not { } core) return;
        var source = core.Source;
        if (!_reading.Contains(id) && !stop) await ToggleReaderAsync(id);
        if (!_reading.Contains(id) || core.Source != source) return;
        HidePopup();
        try
        {
            await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate", JsonSerializer.Serialize(new
            {
                expression = $"document.getElementById('sol-reader-view')?.{(stop ? "solStop" : "solListen")}?.()",
                userGesture = !stop, awaitPromise = true,
            }));
        }
        catch (Exception e) when (e is InvalidOperationException or COMException)
        { Notice(T("Lecture indisponible", "Reading unavailable"), T("Réessayez après le chargement de la page.", "Try again after the page has loaded.")); }
    }

    private async Task EndReaderOnNavigationAsync(string id)
    {
        if (_pages.CoreOf(id) is not { } core) return;
        try { await core.ExecuteScriptAsync("(() => {const h=document.getElementById('sol-reader-view');if(h?.solArticle && h.solArticle.url!==location.href){h.solRestore();h.remove();}})()"); }
        catch (Exception e) when (e is InvalidOperationException or COMException) { /* the old document is gone */ }
    }

    // Conservé comme alias pour les fichiers d'outils Sol AI compilés dans Browser.Core.Tests.
    private static bool IsWebAddress(string url) => IsWeb(url);

    private bool _extensionsOpen;
    private ExtensionPopupHost? _extensionPopup;

    /// <summary>Encart flottant où s'ouvre la fenêtre d'une extension.</summary>
    public ExtensionPopupHost? ExtensionPopup
    {
        get => _extensionPopup;
        init { _extensionPopup = value; if (value is not null) value.TabRequested += url => { Open(url); Refresh(); }; }
    }
}
