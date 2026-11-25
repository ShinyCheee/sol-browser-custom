namespace Browser.Core;

// L'accord appartient au profil et n'est actif qu'après son enregistrement durable.
public static class SolAiPermissions
{
    private static readonly HashSet<string> SensitiveHostLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        "login", "signin", "auth", "oauth", "sso", "idp", "accounts",
        "checkout", "billing", "pay", "payment", "payments", "paiement", "banque", "banking",
    };

    private static readonly HashSet<string> SensitivePathSegments = new(StringComparer.OrdinalIgnoreCase)
    {
        "login", "log-in", "signin", "sign-in", "auth", "oauth", "oauth2", "authorize", "sso", "saml",
        "checkout", "billing", "pay", "payment", "payments", "wire", "transfer",
        "2fa", "mfa", "otp", "totp", "passkey", "webauthn",
        "password", "passwords", "reset-password", "forgot-password", "change-password",
        "connexion", "se-connecter", "paiement", "paiements", "virement", "virements", "facturation",
    };

    private static readonly HashSet<string> WebExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".html", ".htm", ".php", ".asp", ".aspx", ".jsp",
    };

    public static bool VoiceAvailable => Features.Ai;

    public static bool TrySet(Settings settings, string path, bool enabled)
    {
        var previous = settings.SolAiAutoApproveActions;
        settings.SolAiAutoApproveActions = enabled;
        if (JsonFileStore.Save(path, settings)) return true;
        settings.SolAiAutoApproveActions = previous;
        return false;
    }

    public static bool RequiresApproval(string tool, Settings settings) =>
        RequiresApproval(tool, settings, null);

    public static bool RequiresApproval(string tool, Settings settings, string? url) =>
        SolAiAgent.NeedsApproval(tool) && (!settings.SolAiAutoApproveActions || IsSensitiveUrl(url));

    /// <summary>
    /// Détecte par segments d'hôte et de chemin les pages d'authentification, de code à usage unique et de paiement,
    /// sans bloquer à faux des pages documentaires comme « /docs/authentication ».
    /// </summary>
    public static bool IsSensitiveUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme is not ("http" or "https")) return false;
        if (uri.UserInfo.Length > 0) return true;

        var hostLabels = uri.IdnHost.Split('.', StringSplitOptions.RemoveEmptyEntries);
        // On inspecte les sous-domaines (et le domaine principal hors TLD) par label exact.
        var hostCount = hostLabels.Length > 1 ? hostLabels.Length - 1 : hostLabels.Length;
        for (var i = 0; i < hostCount; i++)
            if (SensitiveHostLabels.Contains(hostLabels[i])) return true;

        string decodedPath;
        try { decodedPath = Uri.UnescapeDataString(uri.AbsolutePath); }
        catch (UriFormatException) { decodedPath = uri.AbsolutePath; }

        foreach (var rawSegment in decodedPath.Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            var ext = Path.GetExtension(rawSegment);
            var segment = WebExtensions.Contains(ext) ? Path.GetFileNameWithoutExtension(rawSegment) : rawSegment;
            if (SensitivePathSegments.Contains(segment)) return true;
        }
        return false;
    }
}
