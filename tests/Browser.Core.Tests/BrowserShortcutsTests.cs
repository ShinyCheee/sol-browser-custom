using Browser.Core;

public class BrowserShortcutsTests
{
    [Fact]
    public void Bindings_are_unique_and_share_localized_labels()
    {
        var shortcuts = BrowserShortcuts.All;
        Assert.Equal(shortcuts.Count, shortcuts.Select(s => (s.Key, s.Modifiers)).Distinct().Count());
        Assert.All(shortcuts, s => Assert.False(string.IsNullOrWhiteSpace(s.French) || string.IsNullOrWhiteSpace(s.English)));
        Assert.Contains(shortcuts, s => s.Key == 0x48 && s.Modifiers == 2 && s.Action == "history.open");
        Assert.Equal("Ctrl+H", BrowserShortcuts.TextFor("history.open", false));
        Assert.Equal("Ctrl+Maj+P", BrowserShortcuts.TextFor("palette.open", false));
        Assert.Equal("Ctrl+Shift+P", BrowserShortcuts.TextFor("palette.open", true));
        Assert.Equal("F9", BrowserShortcuts.TextFor("reader.toggle", false));
        Assert.Equal("Ctrl+M", BrowserShortcuts.TextFor("voice.toggle", false));
        Assert.Single(shortcuts, s => s.Action.StartsWith("voice.", StringComparison.Ordinal));
        Assert.Equal(new Command("voice.toggle"), CommandParser.Parse("{\"type\":\"voice.toggle\"}"));
        Assert.All(shortcuts.Where(s => (s.Modifiers & 1) != 0), alt =>
            Assert.Contains(shortcuts, alternative => alternative.Action == alt.Action && (alternative.Modifiers & 1) == 0));
        // Réflexes de Chrome : Alt+D et F6, Ctrl+Page suivante/précédente, Ctrl+Maj+R, Ctrl+F5, Ctrl+Maj+J.
        foreach (var (key, modifiers, action) in new (uint, uint, string)[] { (0x44, 1, "address.focus"), (0x75, 0, "address.focus"), (0x22, 2, "tab.next"),
            (0x21, 2, "tab.previous"), (0x52, 6, "nav.reload"), (0x74, 2, "nav.reload"), (0x4A, 6, "devtools.open") })
            Assert.Contains(shortcuts, s => s.Key == key && s.Modifiers == modifiers && s.Action == action);
        Assert.Equal("Ctrl+L", BrowserShortcuts.TextFor("address.focus", false));
        Assert.Null(CommandParser.Parse("""{"type":"design.toggle"}"""));
        Assert.Equal(new Command("design.toggle", Id: "t1"), CommandParser.Parse("""{"type":"design.toggle","id":"t1"}"""));
    }
}
