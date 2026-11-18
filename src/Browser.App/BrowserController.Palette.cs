using System.Text.Json;
using Browser.Core;
using Microsoft.UI.Xaml;

namespace Browser.App;

public sealed partial class BrowserController
{
    private void OpenPalette()
    {
        HidePopup();
        var generation = ++_paletteGeneration;
        var items = new List<object>();
        var active = _tabs.Tabs.FirstOrDefault(t => t.Id == _tabs.ActiveId);
        var x = (_window.Content as FrameworkElement)?.ActualWidth / 2 ?? 450;
        void Add(string title, Command command, string shortcut = "", string hint = "", string group = "actions", string keywords = "")
        {
            var key = $"{generation}:{items.Count}";
            _paletteCommands[key] = command;
            items.Add(new { id = key, title, hint, shortcut = shortcut.Length > 0 ? shortcut : BrowserShortcuts.TextFor(command.Type, Language.Current == "en"), group, keywords });
        }
        Add(T("Nouvel onglet", "New tab"), new("tab.open"), keywords: "onglet tab new nouveau");
        Add(T("Espaces de travail enregistrés", "Saved workspaces"), new("workspace.open"), keywords: "workspace snapshot disposition maquettes projet");
        Add(T("Rouvrir l’onglet fermé", "Reopen closed tab"), new("tab.reopen"), keywords: "reopen rouvrir fermer onglet");
        Add(T("Navigation privée", "Private browsing"), new("window.private"), keywords: "private incognito privee");
        Add(T("Ouvrir les notes", "Open notes"), new("notes.manage"), keywords: "notes scratchpad");
        if (!PrivateActive) Add(T("Activer ou arrêter la voix de Sol AI", "Start or stop Sol AI voice"), new("voice.toggle"), keywords: "voice voix micro orb orbe conversation");
        Add(T("Ajouter une note rapide", "Add a quick note"), new("notes.open"), keywords: "notes create ajouter");
        Add(T("Historique", "History"), new("history.open", X: x, Y: 70), keywords: "history historique visites");
        Add(T("Favoris", "Bookmarks"), new("library.open", X: x, Y: 70), keywords: "bookmarks favoris");
        Add(T("Téléchargements", "Downloads"), new("downloads.open", X: x, Y: 70), keywords: "downloads telechargements");
        Add(T("Extensions", "Extensions"), new("extensions.open"), keywords: "extensions modules");
        Add(T("Réglages", "Settings"), new("settings.open", X: x, Y: 70), keywords: "settings parametres preferences");
        Add(T("Espaces et profils", "Spaces and profiles"), new("profile.menu", X: x, Y: 70), keywords: "profile espace compte");
        if (active is { Private: false }) Add(T("Session de cet onglet", "Tab session"), new("session.menu", Id: active.Id, X: x, Y: 70), keywords: "compte session cookies admin user invite");
        Add(T("Plein écran", "Full screen"), new("window.maximize"), keywords: "fullscreen plein ecran");
        if (active is not null)
        {
            Add(T("Fermer l’onglet", "Close tab"), new("tab.close", Id: active.Id), keywords: "close fermer onglet");
            Add(T("Recharger la page", "Reload page"), new("nav.reload", Id: active.Id), keywords: "reload refresh actualiser");
            if (_pages.CanGoBack(active.Id)) Add(T("Page précédente", "Previous page"), new("nav.back", Id: active.Id));
            if (_pages.CanGoForward(active.Id)) Add(T("Page suivante", "Next page"), new("nav.forward", Id: active.Id));
            Add(T("Afficher côte à côte", "Show side by side"), new("split.open", Id: active.Id), keywords: "split cote a cote partager");
            if (_split.Contains(active.Id)) Add(T("Quitter la vue côte à côte", "Exit side by side"), new("split.close"), keywords: "split close fermer");
            if (_pages.CoreOf(active.Id) is not null)
            {
                Add(T("Capture d’écran", "Screenshot"), new("capture.menu"), keywords: "capture screenshot image");
                Add(T("Inspecteur réseau", "Network inspector"), new("network.toggle"), keywords: "network reseau requetes");
                Add(T("DevTools natifs", "Native DevTools"), new("devtools.open"), keywords: "devtools debug elements css storage performance f12");
            }
            if (IsWeb(active.Url) && !active.Url.StartsWith("https://start.sol/", StringComparison.OrdinalIgnoreCase) && !_pages.IsPdf(active.Id))
            {
                Add(_reading.Contains(active.Id) ? T("Quitter le mode lecteur", "Exit reader mode") : T("Mode lecteur", "Reader mode"), new("reader.toggle", Id: active.Id), keywords: "reader lecture lire ecouter voix");
                Add(T("Traduire la page", "Translate page"), new("translation.open", Id: active.Id, X: x, Y: 70), keywords: "translate traduction francais anglais");
                Add(T("Inspecteur de design", "Design inspector"), new("design.toggle", Id: active.Id), keywords: "design css police couleur inspecter survol");
                Add(T("Lecture à voix haute", "Read aloud"), new("reader.listen", Id: active.Id), keywords: "speech ecouter voix pause reprendre");
                if (_reading.Contains(active.Id)) Add(T("Arrêter la lecture vocale", "Stop reading aloud"), new("reader.stop", Id: active.Id));
                Add(_db.IsBookmarked(active.Url) ? T("Retirer des favoris", "Remove bookmark") : T("Ajouter aux favoris", "Add bookmark"), new("bookmark.toggle", Id: active.Id), keywords: "bookmark favoris");
            }
        }
        for (var i = 0; i < _tabs.Tabs.Count; i++)
        {
            var tab = _tabs.Tabs[i];
            var slot = i < 8 ? i + 1 : i == _tabs.Tabs.Count - 1 ? 9 : 0;
            Add(tab.Title, new("tab.activate", Id: tab.Id), shortcut: BrowserShortcuts.TextFor($"tab.{slot}", Language.Current == "en"), hint: tab.Url == QuickNotes.PageUrl ? "sol://notes" : tab.Url, group: "tabs", keywords: "onglet tab");
        }
        _paletteItems = items;
        _popup.ShowCentered(500, PaletteJson(), top: 80);
    }

    private string PaletteJson() => JsonSerializer.Serialize(new
    {
        popup = "palette", items = _paletteItems,
        listHeight = Math.Clamp((((_window.Content as FrameworkElement)?.ActualHeight ?? 640) - 120) / _settings.UiFactor - 130, 60, 340),
    });

    private void PickMenuItem(int index)
    {
        if (_menu is not { } menu || index < 0 || index >= menu.Count) return;
        _afterMenu = null;
        menu[index].Run?.Invoke(); // avant la fermeture : une commande du moteur doit être choisie avant de lui rendre la main
        HidePopup();
        Refresh();
        var after = _afterMenu;
        _afterMenu = null;
        after?.Invoke();
    }
}
