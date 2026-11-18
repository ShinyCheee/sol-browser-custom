namespace Browser.Core;

public sealed partial class TabManager
{
    /// <summary>Déplace le groupe entier vers une frontière de la liste, sans couper un autre groupe.</summary>
    public bool MoveGroup(string id, int index)
    {
        var first = _tabs.FindIndex(t => t.GroupId == id);
        if (first < 0 || index < 0 || index > _tabs.Count) return false;
        var members = _tabs.Where(t => t.GroupId == id).ToList();
        var last = _tabs.FindLastIndex(t => t.GroupId == id);
        index = Math.Max(PinnedCount, index);
        if (first + members.Count - 1 == last && index >= first && index <= last + 1) return true;
        if (index < _tabs.Count && _tabs[index].GroupId is { } target && target != id)
            index = index > first ? _tabs.FindLastIndex(t => t.GroupId == target) + 1
                : _tabs.FindIndex(t => t.GroupId == target);
        var targetPos = _tabs.Take(index).Count(t => t.GroupId != id);
        _tabs.RemoveAll(t => t.GroupId == id);
        _tabs.InsertRange(targetPos, members);
        Changed?.Invoke();
        return true;
    }
}
