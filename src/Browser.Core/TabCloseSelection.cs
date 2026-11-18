namespace Browser.Core;

/// <summary>
/// Choix du prochain onglet actif lorsqu'un onglet est fermé :
/// - Fermer un onglet en arrière-plan (en veille ou non) ne change jamais l'onglet affiché.
/// - Fermer l'onglet actif ne réveille jamais un onglet en veille, ne bascule jamais sur un onglet épinglé
///   ni dans un autre groupe.
/// - Si l'onglet fermé appartenait à un groupe ouvert contenant un autre onglet déjà chargé, on reste dans ce groupe ;
///   sinon on revient au dernier onglet libre déjà chargé, ou <c>null</c> pour ouvrir un nouvel onglet.
/// </summary>
public static class TabCloseSelection
{
    public static string? NextActive(
        IReadOnlyList<Tab> tabs,
        IReadOnlyList<TabGroup> groups,
        IReadOnlyList<string> recentIds,
        string closingId,
        string? currentActiveId,
        Func<string, bool> isAsleep,
        Func<string, bool>? isShortcut = null,
        string? splitPartnerId = null)
    {
        if (currentActiveId != closingId) return currentActiveId;

        var closingIndex = -1;
        for (var i = 0; i < tabs.Count; i++)
        {
            if (tabs[i].Id == closingId)
            {
                closingIndex = i;
                break;
            }
        }
        if (closingIndex < 0) return null;

        var closing = tabs[closingIndex];
        bool Awake(Tab t) =>
            t.Id != closingId
            && !t.Pinned
            && !isAsleep(t.Id)
            && (isShortcut is null || !isShortcut(t.Id));

        // En vue scindée, l'autre moitié déjà affichée à l'écran garde naturellement le focus.
        if (splitPartnerId is not null)
        {
            var partner = tabs.FirstOrDefault(t => t.Id == splitPartnerId);
            if (partner is not null && Awake(partner) && (partner.GroupId is null || partner.GroupId == closing.GroupId))
                return partner.Id;
        }

        // 1. Fermeture à l'intérieur d'un groupe ouvert : rester sur un onglet déjà chargé de ce même groupe.
        if (closing.GroupId is { } groupId && groups.Any(g => g.Id == groupId && !g.Collapsed))
        {
            for (var r = recentIds.Count - 1; r >= 0; r--)
            {
                var candidate = tabs.FirstOrDefault(t => t.Id == recentIds[r]);
                if (candidate is not null && candidate.GroupId == groupId && Awake(candidate))
                    return candidate.Id;
            }
            for (var offset = 1; offset < tabs.Count; offset++)
            {
                foreach (var idx in new[] { closingIndex + offset, closingIndex - offset })
                {
                    if (idx >= 0 && idx < tabs.Count && tabs[idx].GroupId == groupId && Awake(tabs[idx]))
                        return tabs[idx].Id;
                }
            }
        }

        // 2. Dernier onglet libre (hors groupe, non épinglé, non en veille) consulté récemment.
        for (var r = recentIds.Count - 1; r >= 0; r--)
        {
            var candidate = tabs.FirstOrDefault(t => t.Id == recentIds[r]);
            if (candidate is not null && candidate.GroupId is null && Awake(candidate))
                return candidate.Id;
        }

        // 3. Autre onglet libre déjà chargé (ex. ouvert en arrière-plan sans activation préalable).
        for (var offset = 1; offset < tabs.Count; offset++)
        {
            foreach (var idx in new[] { closingIndex + offset, closingIndex - offset })
            {
                if (idx >= 0 && idx < tabs.Count && tabs[idx].GroupId is null && Awake(tabs[idx]))
                    return tabs[idx].Id;
            }
        }

        return null;
    }
}
