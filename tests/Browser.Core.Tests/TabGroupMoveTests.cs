using Browser.Core;

public class TabGroupMoveTests
{
    [Fact]
    public void Moving_a_group_preserves_members_order_active_page_and_other_groups()
    {
        var m = new TabManager();
        var pin = m.Open("pin", pinned: true);
        var a = m.Open("a"); var b = m.Open("b"); var c = m.Open("c"); var d = m.Open("d");
        var first = m.CreateGroup(a.Id, "First")!; m.AddToGroup(b.Id, first.Id);
        var second = m.CreateGroup(c.Id, "Second")!; m.AddToGroup(d.Id, second.Id);
        m.Activate(a.Id);
        Assert.True(m.MoveGroup(first.Id, 4)); // destination inside the other group snaps past it
        Assert.Equal([pin.Id, c.Id, d.Id, a.Id, b.Id], m.Tabs.Select(t => t.Id));
        Assert.Equal(a.Id, m.ActiveId);
        Assert.True(m.MoveGroup(first.Id, 0)); // the pinned prefix stays intact
        Assert.Equal([pin.Id, a.Id, b.Id, c.Id, d.Id], m.Tabs.Select(t => t.Id));
        Assert.Equal(first.Id, m.Tabs[1].GroupId);
        Assert.Equal(second.Id, m.Tabs[3].GroupId);
        Assert.Equal(2, m.Groups.Count);
    }

    [Fact]
    public void Moving_inside_the_group_is_a_noop_and_invalid_targets_do_not_mutate()
    {
        var m = new TabManager(); var a = m.Open("a"); var b = m.Open("b");
        var group = m.CreateGroup(a.Id, "Group")!; m.AddToGroup(b.Id, group.Id);
        var before = m.Tabs.ToArray();
        Assert.True(m.MoveGroup(group.Id, 1));
        Assert.False(m.MoveGroup(group.Id, -1));
        Assert.False(m.MoveGroup(group.Id, 3));
        Assert.False(m.MoveGroup("missing", 0));
        Assert.Equal(before, m.Tabs);
    }

    [Fact]
    public void Splitting_middle_tab_into_new_group_then_moving_original_group_preserves_all_tabs()
    {
        var m = new TabManager();
        var a = m.Open("a"); var b = m.Open("b"); var c = m.Open("c"); var d = m.Open("d");
        var g1 = m.CreateGroup(a.Id, "G1")!;
        m.AddToGroup(b.Id, g1.Id);
        m.AddToGroup(c.Id, g1.Id);

        var g2 = m.CreateGroup(b.Id, "G2")!;
        Assert.Equal([a.Id, c.Id, b.Id, d.Id], m.Tabs.Select(t => t.Id));

        Assert.True(m.MoveGroup(g1.Id, 4));
        Assert.Equal([b.Id, d.Id, a.Id, c.Id], m.Tabs.Select(t => t.Id));
        Assert.Equal(4, m.Tabs.Select(t => t.Id).Distinct().Count());
        Assert.Equal(g2.Id, m.Tabs[0].GroupId);
        Assert.Null(m.Tabs[1].GroupId);
        Assert.Equal(g1.Id, m.Tabs[2].GroupId);
        Assert.Equal(g1.Id, m.Tabs[3].GroupId);
    }

    [Theory]
    [InlineData("tab.pin")]
    [InlineData("group.move")]
    [InlineData("shortcut.move")]
    public void Sidebar_moves_require_string_identifiers_and_integer_positions(string type)
    {
        Assert.NotNull(CommandParser.Parse($$"""{"type":"{{type}}","id":"1","index":0}"""));
        Assert.Null(CommandParser.Parse($$"""{"type":"{{type}}","id":"1","index":0.5}"""));
        Assert.Null(CommandParser.Parse($$"""{"type":"{{type}}","index":0}"""));
    }
}
