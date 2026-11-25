using Browser.App;

namespace Browser.Core.Tests;

public sealed class SolAiPermissionsTests : IDisposable
{
    private readonly string _folder = Path.Combine(Path.GetTempPath(), "sol-permissions-" + Guid.NewGuid());
    private string SettingsPath => Path.Combine(_folder, "settings.json");
    public SolAiPermissionsTests()
    {
        Directory.CreateDirectory(_folder);

    }
    public void Dispose() => Directory.Delete(_folder, true);

    [Fact]
    public void DefaultRequiresApprovalEvenWhenVoiceIsAvailable()
    {
        var settings = new Settings();
        Assert.False(settings.SolAiAutoApproveActions);
        Assert.Equal(Features.Ai, SolAiPermissions.VoiceAvailable);
        foreach (var tool in new[] { "click", "fill", "navigate", "select_option", "set_checked", "fill_form", "press_key", "close_tabs", "browser_history" })
            Assert.True(SolAiPermissions.RequiresApproval(tool, settings));
        Assert.False(SolAiPermissions.RequiresApproval("read_page", settings));
    }

    [Fact]
    public async Task MatchingChatGrantPersistsAndReleasesBothViews()
    {
        var controller = new BrowserController { AiPermissionsPath = SettingsPath };
        var chat = controller.PendingPermission("chat");
        var page = controller.PendingPermission("page", chat: false);
        controller.GrantAlways("chat");
        Assert.True(await chat);
        Assert.True(await page);
        var restarted = JsonFileStore.Load<Settings>(SettingsPath);
        Assert.True(restarted.SolAiAutoApproveActions);
        Assert.False(SolAiPermissions.RequiresApproval("fill_form", restarted));
        controller.SetPermission(false);
        Assert.True(SolAiPermissions.RequiresApproval("click", JsonFileStore.Load<Settings>(SettingsPath)));
    }

    [Fact]
    public async Task SettingsGrantReleasesPendingAndRevokesForNextAction()
    {
        var controller = new BrowserController { AiPermissionsPath = SettingsPath };
        var pending = controller.PendingPermission("current");
        controller.SetPermission(true);
        Assert.True(await pending);
        controller.SetPermission(false);
        Assert.False(controller.PermissionSettings.SolAiAutoApproveActions);
        var next = controller.PendingPermission("next");
        controller.GrantAlways("current");
        Assert.False(next.IsCompleted);
        Assert.False(controller.PermissionSettings.SolAiAutoApproveActions);
    }

    [Fact]
    public void InvalidDisconnectedAndPrivateGrantsAreIgnored()
    {
        var controller = new BrowserController { AiPermissionsPath = SettingsPath };
        controller.GrantAlways("invented");
        var pending = controller.PendingPermission("real");
        controller.GrantAlways("stale");
        controller.Ready = false;
        controller.GrantAlways("real");
        controller.Ready = true;
        controller.PrivateContext = true;
        controller.GrantAlways("real");
        controller.SetPermission(true);
        Assert.False(pending.IsCompleted);
        Assert.False(controller.PermissionSettings.SolAiAutoApproveActions);
        Assert.False(File.Exists(SettingsPath));
    }

    [Fact]
    public async Task CancelledApprovalCannotGrantStandingPermission()
    {
        var controller = new BrowserController { AiPermissionsPath = SettingsPath };
        var pending = controller.PendingPermission("cancelled");
        controller.CancelPermission();
        controller.GrantAlways("cancelled");
        Assert.True(pending.IsCompletedSuccessfully);
        Assert.False(await pending);
        Assert.False(controller.PermissionSettings.SolAiAutoApproveActions);
    }

    [Fact]
    public void SaveFailureDoesNotGrantOrReleasePending()
    {
        var blocker = Path.Combine(_folder, "file");
        File.WriteAllText(blocker, "block directory creation");

        var controller = new BrowserController { AiPermissionsPath = SettingsPath };
        controller.AiPermissionsPath = Path.Combine(blocker, "settings.json");
        var pending = controller.PendingPermission("action");
        controller.GrantAlways("action");
        Assert.False(pending.IsCompleted);
        Assert.False(controller.PermissionSettings.SolAiAutoApproveActions);
        Assert.NotNull(controller.PermissionNotice);
    }

    [Fact]
    public void PermanentApprovalCommandRequiresAnId()
    {
        Assert.Null(CommandParser.Parse("""{"type":"ai.approve.always"}"""));
        Assert.Equal("real", CommandParser.Parse("""{"type":"ai.approve.always","id":"real"}""")!.Id);
    }

    [Theory]
    [InlineData("https://developer.example.com/docs/authentication", false)]
    [InlineData("https://example.com/blog/payment-gateways-explained", false)]
    [InlineData("https://example.com/css/display", false)]
    [InlineData("https://example.com/login", true)]
    [InlineData("https://example.com/user/signin.php", true)]
    [InlineData("https://shop.example.com/cart/checkout", true)]
    [InlineData("https://app.example.com/settings/billing", true)]
    [InlineData("https://app.example.com/verify/2fa", true)]
    [InlineData("https://app.example.com/challenge/otp", true)]
    [InlineData("https://service.example.fr/espace/connexion", true)]
    [InlineData("https://boutique.example.fr/commande/paiement", true)]
    [InlineData("https://client.example.fr/comptes/virement", true)]
    [InlineData("https://accounts.google.com/Service", true)]
    public void SensitiveUrlMatchesExactHostAndPathSegmentsWithoutBlockingDocumentation(string url, bool sensitive)
    {
        Assert.Equal(sensitive, SolAiPermissions.IsSensitiveUrl(url));
        var auto = new Settings { SolAiAutoApproveActions = true };
        Assert.Equal(sensitive, SolAiPermissions.RequiresApproval("click", auto, url));
        Assert.False(SolAiPermissions.RequiresApproval("read_page", auto, url));
    }
}
