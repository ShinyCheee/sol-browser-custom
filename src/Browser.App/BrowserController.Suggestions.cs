using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    private void Suggest(string tabId, string query, double x, double y, double width)
    {
        var q = query.Trim();
        var seq = ++_suggestSeq;
        var isPrivate = AppPaths.Private || _pages.IsPrivate(tabId) || _tabs.Tabs.Any(t => t.Id == tabId && t.Private);
        IReadOnlyList<Visit> history = q.Length == 0 || isPrivate ? [] : _db.Suggest(q, 3);

        // Une requête vide (champ vidé ou quitté) ne referme que les suggestions, pas un autre panneau ouvert entre-temps.
        // Pas tout de suite : cliquer une suggestion fait d'abord perdre le curseur à la barre d'adresse, et une
        // fermeture immédiate avalerait ce clic. Si rien n'est venu entre-temps, les suggestions se referment.
        if (q.Length == 0)
        {
            if (_suggesting) _ = CloseSuggestionsSoonAsync();
            return;

            async Task CloseSuggestionsSoonAsync()
            {
                await Task.Delay(180);
                if (seq == _suggestSeq && _suggesting) HidePopup();
            }
        }
        ShowSuggestions(Suggestions.Build(q, history, _settings.SearchUrlTemplate));

        // Les résultats locaux s'affichent tout de suite ; les complétions du moteur de recherche s'y ajoutent à leur arrivée.
        // Ce qui ressemble à une adresse (avec « / » ou « : ») ou vient d'un onglet privé n'est jamais envoyé.
        if (!isPrivate && _settings.OnlineSuggestions && q.Length >= 2 && !q.Contains('/') && !q.Contains(':'))
            _ = AddOnlineSuggestionsAsync(seq, q, history);

        void ShowSuggestions(IReadOnlyList<Suggestion> items)
        {
            _suggestions = items;
            var json = JsonSerializer.Serialize(new
            {
                popup = "suggestions",
                items = items.Select(v => new { url = v.Url, title = v.Title, kind = v.Kind }),
            });
            if (_suggesting && _popup.IsOpen && _suggestTab == tabId) _popup.Post(json);
            else _popup.Show(x, y, width, json, focus: false); // le curseur reste dans la barre d'adresse
            _suggestTab = tabId;
            _suggesting = true;
            _bridge.Post(JsonSerializer.Serialize(new
            {
                @event = "suggestions",
                id = tabId,
                count = items.Count,
                items = items.Select(v => new { url = v.Url, value = v.Kind == "search" ? v.Title : v.Url }),
            }));
        }

        async Task AddOnlineSuggestionsAsync(int forSeq, string text, IReadOnlyList<Visit> local)
        {
            try
            {
                var json = await Http.GetStringAsync(string.Format(_settings.SuggestUrlTemplate, Uri.EscapeDataString(text)));
                if (forSeq != _suggestSeq || !_suggesting) return; // l'utilisateur a continué à taper ou a quitté le champ
                ShowSuggestions(Suggestions.Build(text, local, _settings.SearchUrlTemplate, Suggestions.ParseGoogle(json)));
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
            {
                // hors ligne ou service lent : on garde les suggestions locales
            }
        }
    }

    // Certains sites refusent une requête sans agent : celui-ci ne dit rien de l'ordinateur.
    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(4),
        DefaultRequestHeaders = { { "User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sol" } },
    };
    private int _suggestSeq;

    // Menus affichés dans la vue posée sur la page : un libellé et son action ; un libellé vide est un séparateur.
    private List<(string Label, Action? Run)>? _menu;
    private Action? _menuDismissed; // appelé à la fermeture du menu, avec ou sans choix

    // Largeur réelle d'un panneau : celle qu'il demande, à l'échelle de l'interface. Sert à l'aligner par son bord droit.
    private double Scaled(double width) => width * _settings.UiFactor;

    private void ShowMenu(double x, double y, List<(string Label, Action? Run)> items, Action? dismissed = null)
    {
        HidePopup();
        (_menu, _menuDismissed) = (items, dismissed);
        _popup.Show(x, y, 260, JsonSerializer.Serialize(new { popup = "menu", items = items.Select(i => i.Label) }), focus: true);
    }
}
