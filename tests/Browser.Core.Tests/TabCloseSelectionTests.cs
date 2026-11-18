using Browser.Core;
using Xunit;

namespace Browser.Core.Tests;

public sealed class TabCloseSelectionTests
{
    [Fact]
    public void ClosingBackgroundOrSleepingTab_KeepsCurrentActiveTab()
    {
        var tabs = new Tab[]
        {
            new("t1", "https://a.test", "A"),
            new("t2", "https://b.test", "B"),
        };
        var asleep = new HashSet<string> { "t2" };

        var next = TabCloseSelection.NextActive(tabs, [], ["t1"], "t2", "t1", asleep.Contains);

        Assert.Equal("t1", next);
    }

    [Fact]
    public void ClosingActiveFreeTab_NeverSwitchesToSleepingPinnedOrGroupedTabs()
    {
        var groups = new TabGroup[] { new("g1", "Travail", "#8fa8e8", Collapsed: false) };
        var tabs = new Tab[]
        {
            new("p1", "https://pin.test", "Pin", Pinned: true),
            new("g_awake", "https://group.test", "Group", GroupId: "g1"),
            new("sleep1", "https://sleep.test", "Sleep"),
            new("active", "https://active.test", "Active"),
        };
        var asleep = new HashSet<string> { "sleep1" };

        // Même si p1 et g_awake étaient dans l'historique récent, aucun onglet libre éveillé ne reste -> null (nouvel onglet).
        var next = TabCloseSelection.NextActive(
            tabs, groups, ["p1", "g_awake", "sleep1", "active"], "active", "active", asleep.Contains);

        Assert.Null(next);
    }

    [Fact]
    public void ClosingActiveFreeTab_SelectsMostRecentAwakeFreeTab()
    {
        var groups = new TabGroup[] { new("g1", "Travail", "#8fa8e8", Collapsed: false) };
        var tabs = new Tab[]
        {
            new("p1", "https://pin.test", "Pin", Pinned: true),
            new("free1", "https://one.test", "One"),
            new("free2", "https://two.test", "Two"),
            new("g_tab", "https://group.test", "Group", GroupId: "g1"),
            new("active", "https://active.test", "Active"),
        };

        var next = TabCloseSelection.NextActive(
            tabs, groups, ["free1", "free2", "g_tab", "p1", "active"], "active", "active", _ => false);

        Assert.Equal("free2", next);
    }

    [Fact]
    public void ClosingTabInExpandedGroup_StaysOnAwakeTabInSameGroup()
    {
        var groups = new TabGroup[]
        {
            new("g1", "Travail", "#8fa8e8", Collapsed: false),
            new("g2", "Autre", "#8ccfa6", Collapsed: false),
        };
        var tabs = new Tab[]
        {
            new("free1", "https://free.test", "Free"),
            new("g1_sleep", "https://s.test", "Sleep", GroupId: "g1"),
            new("g1_awake", "https://a.test", "Awake", GroupId: "g1"),
            new("g1_closing", "https://c.test", "Closing", GroupId: "g1"),
            new("g2_awake", "https://o.test", "OtherGroup", GroupId: "g2"),
        };
        var asleep = new HashSet<string> { "g1_sleep" };

        var next = TabCloseSelection.NextActive(
            tabs, groups, ["free1", "g2_awake", "g1_closing"], "g1_closing", "g1_closing", asleep.Contains);

        Assert.Equal("g1_awake", next);
    }

    [Fact]
    public void ClosingLastAwakeTabInExpandedGroup_FallsBackToRecentFreeTabOrNull()
    {
        var groups = new TabGroup[]
        {
            new("g1", "Travail", "#8fa8e8", Collapsed: false),
            new("g2", "Autre", "#8ccfa6", Collapsed: false),
        };
        var tabs = new Tab[]
        {
            new("p1", "https://pin.test", "Pin", Pinned: true),
            new("g1_sleep", "https://s.test", "Sleep", GroupId: "g1"),
            new("g1_closing", "https://c.test", "Closing", GroupId: "g1"),
            new("g2_awake", "https://o.test", "OtherGroup", GroupId: "g2"),
        };
        var asleep = new HashSet<string> { "g1_sleep" };

        // Ne réveille pas g1_sleep, n'entre pas dans g2_awake et n'active pas p1 -> null (nouvel onglet).
        Assert.Null(TabCloseSelection.NextActive(
            tabs, groups, ["p1", "g2_awake", "g1_closing"], "g1_closing", "g1_closing", asleep.Contains));

        // Si un onglet libre chargé existe, on y revient.
        var withFree = tabs.Append(new Tab("free1", "https://free.test", "Free")).ToArray();
        Assert.Equal("free1", TabCloseSelection.NextActive(
            withFree, groups, ["free1", "g1_closing"], "g1_closing", "g1_closing", asleep.Contains));
    }

    [Fact]
    public void ClosingTabInCollapsedGroup_DoesNotStayInCollapsedGroup()
    {
        var groups = new TabGroup[] { new("g1", "Replié", "#8fa8e8", Collapsed: true) };
        var tabs = new Tab[]
        {
            new("g1_other", "https://o.test", "Other", GroupId: "g1"),
            new("g1_closing", "https://c.test", "Closing", GroupId: "g1"),
        };

        var next = TabCloseSelection.NextActive(
            tabs, groups, ["g1_other", "g1_closing"], "g1_closing", "g1_closing", _ => false);

        Assert.Null(next);
    }
}
