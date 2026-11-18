using System.Net;
using System.Net.Sockets;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Browser.Core;

namespace Browser.App;

[SupportedOSPlatform("windows")]
public sealed partial class ChatGptAccount
{
    // Identifiant d'hôte opaque et stable, choisi avant la première connexion.
    private string HostId() => Locked(() =>
    {
        string? saved = null;
        try { saved = File.ReadAllText(_hostFile).Trim(); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        var id = ChatGptOAuth.HostId(saved);
        if (id != saved) File.WriteAllText(_hostFile, id);
        return id;
    });

    private string RegistrationFile => _file + ".registration";

    private ChatGptRegistration? Registration()
    {
        if (Tokens is { } tokens) return new(tokens.ClientId, tokens.Subject, tokens.Email);
        try { return JsonSerializer.Deserialize<ChatGptRegistration>(ProtectedData.Unprotect(File.ReadAllBytes(RegistrationFile), Entropy, DataProtectionScope.CurrentUser)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CryptographicException or JsonException) { return null; }
    }

    private void SaveRegistration(ChatGptRegistration registration)
    {
        File.WriteAllBytes(RegistrationFile + ".tmp", ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(registration), Entropy, DataProtectionScope.CurrentUser));
        File.Move(RegistrationFile + ".tmp", RegistrationFile, true);
    }

    private ChatGptTokens? Load()
    {
        try { return File.Exists(_file) ? JsonSerializer.Deserialize<ChatGptTokens>(ProtectedData.Unprotect(File.ReadAllBytes(_file), Entropy, DataProtectionScope.CurrentUser)) : null; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CryptographicException or JsonException) { return null; }
    }

    // Écriture atomique, chiffrée pour l'utilisateur Windows ; jamais dans les journaux.
    private void Save(ChatGptTokens tokens)
    {
        var temp = _file + ".tmp";
        File.WriteAllBytes(temp, ProtectedData.Protect(JsonSerializer.SerializeToUtf8Bytes(tokens), Entropy, DataProtectionScope.CurrentUser));
        File.Move(temp, _file, true);
    }

    private T Locked<T>(Func<T> run)
    {
        using var mutex = new Mutex(false, _lock);
        try { mutex.WaitOne(); } catch (AbandonedMutexException) { }
        try { return run(); }
        finally { mutex.ReleaseMutex(); }
    }

    private void Locked(Action run) => Locked(() => { run(); return 0; });

    private async Task<(string Jwks, string Revocation)> DiscoverAsync(CancellationToken ct)
    {
        if (_discovery is { } known) return known;
        using var config = JsonDocument.Parse(await _http.GetStringAsync(ChatGptOAuth.Discovery, ct));
        string Endpoint(string name) => config.RootElement.GetProperty(name).GetString() is { } url && url.StartsWith(ChatGptOAuth.Issuer + "/", StringComparison.Ordinal)
            ? url : throw new ChatGptException("discovery-failed");
        if (config.RootElement.GetProperty("issuer").GetString() != ChatGptOAuth.Issuer) throw new ChatGptException("discovery-failed");
        var jwks = await _http.GetStringAsync(Endpoint("jwks_uri"), ct);
        return (_discovery = (jwks, Endpoint("revocation_endpoint"))).Value;
    }

    private async Task<string> PostAsync(string url, Dictionary<string, string> form, CancellationToken ct)
    {
        using var response = await _http.PostAsync(url, new FormUrlEncodedContent(form), ct);
        var body = await response.Content.ReadAsStringAsync(ct);
        return response.IsSuccessStatusCode ? body : throw new ChatGptException(ChatGptOAuth.ErrorCode(body, (int)response.StatusCode));
    }

    // Une seule requête GET /auth/callback avec le bon hôte et le bon state termine la connexion ; les autres sont ignorées.
    private static async Task<(string Code, string ClientId, string? Scope)> CallbackAsync(TcpListener listener, string redirect, string state, string? expectedClient, CancellationToken ct)
    {
        var host = new Uri(redirect).Authority;
        while (true)
        {
            using var client = await listener.AcceptTcpClientAsync(ct);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            try
            {
                var stream = client.GetStream();
                using var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, leaveOpen: true);
                var parts = (await reader.ReadLineAsync(timeout.Token) ?? "").Split(' ');
                string? requestHost = null;
                while (await reader.ReadLineAsync(timeout.Token) is { Length: > 0 } header)
                    if (header.StartsWith("Host:", StringComparison.OrdinalIgnoreCase)) requestHost = header[5..].Trim();
                if (parts is not ["GET", var target, _] || requestHost != host || !target.StartsWith("/auth/callback?", StringComparison.Ordinal))
                { await RespondAsync(stream, "404 Not Found", "", timeout.Token); continue; }
                var query = System.Web.HttpUtility.ParseQueryString(target[target.IndexOf('?')..]);
                if (query["state"] is not { } returned || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(returned), Encoding.UTF8.GetBytes(state)))
                { await RespondAsync(stream, "400 Bad Request", "", timeout.Token); continue; }
                var ok = query["error"] == null && query["code"] is { Length: > 0 };
                var clientId = ok ? ChatGptOAuth.CallbackClient(query["client_id"], expectedClient) : "";
                await RespondAsync(stream, "200 OK", ok
                    ? Language.T("Autorisation reçue. Revenez à Sol pour terminer la connexion.", "Authorization received. Return to Sol to finish signing in.")
                    : Language.T("La connexion à ChatGPT n’a pas abouti. Revenez à Sol pour réessayer.", "The ChatGPT sign-in did not complete. Return to Sol to try again."), timeout.Token);
                if (!ok) throw new ChatGptException(query["error"] == "access_denied" ? "access-denied" : "signin-failed");
                return (query["code"]!, clientId, query["scope"]);
            }
            catch (Exception e) when (e is IOException || e is OperationCanceledException && !ct.IsCancellationRequested) { }
        }
    }

    private static async Task RespondAsync(Stream stream, string status, string message, CancellationToken ct)
    {
        var body = message.Length == 0 ? "" : "<!doctype html><meta charset=utf-8><title>Sol</title><body style=\"font:16px system-ui;margin:3em;text-align:center\"><p>"
            + WebUtility.HtmlEncode(message) + "</p>";
        var bytes = Encoding.UTF8.GetBytes(body);
        var head = $"HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {bytes.Length}\r\nCache-Control: no-store\r\n"
            + "Referrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n";
        await stream.WriteAsync(Encoding.ASCII.GetBytes(head), ct);
        await stream.WriteAsync(bytes, ct);
    }
}
