using System.Net;

namespace Browser.Core;

public static class AddressInput
{
    public const string DefaultSearchUrlTemplate = "https://www.google.com/search?q={0}";
    private static readonly string[] Schemes = ["http://", "https://", "file://", "about:"];

    public static bool IsValidUrlTemplate(string? template)
    {
        if (string.IsNullOrWhiteSpace(template) || template.Length > 2048 || template.Any(char.IsControl)) return false;
        var trimmed = template.Trim();
        if (!trimmed.Contains("{0}", StringComparison.Ordinal)) return false;
        return Uri.TryCreate(trimmed.Replace("{0}", "sol", StringComparison.Ordinal), UriKind.Absolute, out var uri)
            && uri.Scheme is "https" or "http" && uri.Host.Length > 0;
    }

    public static string FormatSearchUrl(string? searchUrlTemplate, string query)
    {
        var active = IsValidUrlTemplate(searchUrlTemplate) ? searchUrlTemplate!.Trim() : DefaultSearchUrlTemplate;
        return active.Replace("{0}", Uri.EscapeDataString(query), StringComparison.Ordinal);
    }

    public static string Resolve(string input, string searchUrlTemplate)
    {
        var text = input.Trim();
        if (text.Equals("/notes", StringComparison.OrdinalIgnoreCase) || text.Equals(":notes", StringComparison.OrdinalIgnoreCase)
            || text.TrimEnd('/').Equals("sol://notes", StringComparison.OrdinalIgnoreCase)) return QuickNotes.PageUrl;
        if (Schemes.Any(s => text.StartsWith(s, StringComparison.OrdinalIgnoreCase))) return text;

        // « :3000 » : le serveur de développement de cet ordinateur.
        if (text.Length is >= 2 and <= 6 && text[0] == ':' && text[1..].All(char.IsAsciiDigit)) return "http://localhost" + text;

        if (!text.Contains(' '))
        {
            var host = text.Split('/', 2)[0].Split(':', 2)[0];
            // IPAddress.TryParse accepte "42" (0.0.0.42) : on exige un point pour ne pas détourner une recherche
            if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
                || (host.Contains('.') && IPAddress.TryParse(host, out _)))
                return "http://" + text;
            if (host.Contains('.')) return "https://" + text;
        }
        return FormatSearchUrl(searchUrlTemplate, text);
    }
}
