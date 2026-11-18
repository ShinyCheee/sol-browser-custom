using System.Text.Json.Serialization;

namespace Browser.Core;

public sealed class Settings
{
    public const string DefaultHomePage = "https://start.sol/index.html#start";
    public const string DefaultSuggestUrlTemplate = "https://suggestqueries.google.com/complete/search?client=firefox&ie=utf-8&oe=utf-8&q={0}";

    public bool FanEnabled { get; set; } = true;
    private int _fanTrigger = 2;
    // 0 : survol immédiat, 1 : survol de cinq secondes, 2 : clic droit.
    public int FanTrigger { get => _fanTrigger; set => _fanTrigger = value is >= 0 and <= 2 ? value : 2; }
    public int FanTriggerDefaultsVersion { get; set; }
    public bool ApplyFanDefault()
    {
        if (FanTriggerDefaultsVersion >= 1) return false;
        if (FanTrigger == 0) FanTrigger = 2;
        FanTriggerDefaultsVersion = 1;
        return true;
    }
    public bool StartWallpaperCustom { get; set; }
    public int NotesArchiveDays { get; set; }
    public bool SolAiCategories { get; set; }
    public bool SolAiAutoApproveActions { get; set; }
    private string _solAiChatModel = "";
    public string SolAiChatModel { get => _solAiChatModel; set => _solAiChatModel = value is { Length: <= 100 } ? value : ""; }
    public bool SolAiWelcomeShown { get; set; }
    private int _solAiTone, _solAiLength;
    public int SolAiTone { get => _solAiTone; set => _solAiTone = value is >= 0 and <= 2 ? value : 0; }
    public int SolAiLength { get => _solAiLength; set => _solAiLength = value is >= 0 and <= 2 ? value : 0; }
    public bool SolVoiceReadAloud { get; set; } = true;
    private int _solVoiceDevice = -1;
    public int SolVoiceDevice { get => _solVoiceDevice; set => _solVoiceDevice = value is >= -1 and < 100 ? value : -1; }
    public bool ExtensionDeveloperMode { get; set; }
    public bool FullScreen { get; set; } = true;
    private double _uiScale = 1;
    public double UiScale { get => _uiScale; set => _uiScale = value is 1 or 0.95 or 0.9 or 0.85 or 0.8 ? value : 1; }
    [JsonIgnore]
    public double UiFactor => Math.Round(0.62 + _uiScale * 0.3, 3);
    private double _pageZoom = 1;
    public double PageZoom
    {
        get => _pageZoom;
        set => _pageZoom = double.IsFinite(value) ? Math.Clamp(value, 0.5, 2) : 1;
    }

    private string _searchUrlTemplate = AddressInput.DefaultSearchUrlTemplate;
    public string SearchUrlTemplate
    {
        get => _searchUrlTemplate;
        set => _searchUrlTemplate = AddressInput.IsValidUrlTemplate(value) ? value.Trim() : AddressInput.DefaultSearchUrlTemplate;
    }

    public bool BlurEnabled { get; set; } = true;
    public bool HideScrollbars { get; set; } = true;
    public bool FloatingDownloads { get; set; } = true;
    public bool VideoDownloads { get; set; } = true;
    private int _videoQuality;
    public int VideoQuality { get => _videoQuality; set => _videoQuality = VideoQualitySelection.Preferences.Contains(value) ? value : 0; }
    public string Theme { get; set; } = "page";
    public bool TintTopbar { get; set; } = true;
    public bool TintSidebar { get; set; } = true;
    public bool TintMenus { get; set; } = true;
    public bool TintBackground { get; set; } = true;
    public bool LiveColor { get; set; } = true;
    public bool SavePasswords { get; set; } = true;
    public bool OnlineSuggestions { get; set; } = true;

    private string _suggestUrlTemplate = DefaultSuggestUrlTemplate;
    public string SuggestUrlTemplate
    {
        get => _suggestUrlTemplate;
        set
        {
            var trimmed = value?.Trim();
            _suggestUrlTemplate = AddressInput.IsValidUrlTemplate(trimmed)
                && trimmed!.Replace("{0}", "", StringComparison.Ordinal).IndexOfAny(['{', '}']) < 0
                ? trimmed : DefaultSuggestUrlTemplate;
        }
    }

    private string _homePage = DefaultHomePage;
    public string HomePage
    {
        get => _homePage;
        set => _homePage = string.IsNullOrWhiteSpace(value) || value is "https://www.google.com" or "https://www.google.com/" ? DefaultHomePage : value;
    }
    public bool StartWallpaper { get; set; } = true;
    public int StartWallpaperPhoto { get; set; }
    public bool StartWallpaperDaily { get; set; }
    public string Language { get; set; } = "system";
    public int Spelling { get; set; } = 3;
    public bool SpellingOnline { get; set; } = true;
    public bool Onboarded { get; set; }
    public string ProfileName { get; set; } = "";
    public string Font { get; set; } = "default";
    public bool MemorySaver { get; set; } = true;
    public bool AutoPip { get; set; } = true;
    private double _sidebarWidth = SidePanelLayout.SidebarDefault;
    public double SidebarWidth { get => _sidebarWidth; set => _sidebarWidth = double.IsFinite(value) ? Math.Clamp(value, SidePanelLayout.SidebarMinimum, SidePanelLayout.SidebarMaximum) : SidePanelLayout.SidebarDefault; }
    private double _chatWidth = 380;
    public double ChatWidth { get => _chatWidth; set => _chatWidth = double.IsFinite(value) ? Math.Clamp(value, SidePanelLayout.ChatMinimum, SidePanelLayout.ChatMaximum) : SidePanelLayout.ChatDefault; }
    public double PanelHeight { get; set; } = 300;
    public List<string> CompareDevices { get; set; } = new();
    private List<string> _pinnedExtensions = new();
    public List<string> PinnedExtensions { get => _pinnedExtensions; set => _pinnedExtensions = value?.Where(ExtensionCatalog.IsId).Distinct().ToList() ?? []; }
    public DateTime ExtensionsChecked { get; set; }
    public List<SiteShortcut> Shortcuts { get; set; } =
    [
        new() { Url = "https://github.com", Name = "GitHub" },
        new() { Url = "https://www.youtube.com", Name = "YouTube" },
        new() { Url = "https://devbenin.bj", Name = "DevBenin" },
    ];
}

/// <summary>Raccourci vers un site : son adresse, un nom facultatif, et l'icône du site (en data:) une fois connue.</summary>
public sealed class SiteShortcut
{
    public string Url { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Icon { get; set; }
    public bool NameLocked { get; set; }

    public static string DomainOf(string? url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Host.Length == 0) return "";
        return uri.Host.StartsWith("www.", StringComparison.OrdinalIgnoreCase) ? uri.Host[4..].ToLowerInvariant() : uri.Host.ToLowerInvariant();
    }

    public static string NameOf(string? url)
    {
        var labels = DomainOf(url).Split('.', StringSplitOptions.RemoveEmptyEntries);
        if (labels.Length == 0) return "";
        var skip = labels.Length >= 3 && labels[^2] is "co" or "com" or "org" or "net" or "gov" or "ac" or "edu" ? 3 : 2;
        var label = labels[Math.Max(0, labels.Length - skip)];
        return char.ToUpperInvariant(label[0]) + label[1..];
    }
}

public sealed class Session
{
    public List<string> SessionIds { get; set; } = new();
    public List<string> TranslationOriginals { get; set; } = new();
    public List<string> Urls { get; set; } = new();
    public List<string> Titles { get; set; } = new();
    public int PinnedCount { get; set; }
    public int ActiveIndex { get; set; }
    public int? PrimaryIndex { get; set; }
    public int? SecondaryIndex { get; set; }
    public double Ratio { get; set; } = 0.5;
    public List<SessionGroup> Groups { get; set; } = new();
    public List<int?> GroupOf { get; set; } = new();
    public List<int?> ShortcutOf { get; set; } = new();
    public List<string> Devices { get; set; } = new();
    public List<string> Icons { get; set; } = new();
}

public sealed class SessionGroup
{
    public string Name { get; set; } = "";
    public string Color { get; set; } = "";
    public string Icon { get; set; } = "";
    public bool Collapsed { get; set; }
}
