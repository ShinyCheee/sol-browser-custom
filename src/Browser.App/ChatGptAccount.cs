using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Browser.Core;

namespace Browser.App;

public sealed class ChatGptException(string code) : Exception(code) { public string Code { get; } = code; }

// Compte ChatGPT de ce profil : connexion OAuth (PKCE, retour sur 127.0.0.1), jetons protégés par Windows,
// renouvellement partagé entre les fenêtres et réponses en flux de la Responses API.
[SupportedOSPlatform("windows")]
public sealed partial class ChatGptAccount
{
    private static readonly HttpClient DefaultHttp = new() { Timeout = Timeout.InfiniteTimeSpan };
    private static readonly byte[] Entropy = "Sol.ChatGPT"u8.ToArray();
    private (string Jwks, string Revocation)? _discovery;
    private readonly HttpClient _http;
    private readonly string _file;
    private readonly string _hostFile;
    private readonly string _lock;
    private readonly SemaphoreSlim _refreshGate = new(1, 1);
    private CancellationTokenSource? _signIn;
    private IReadOnlyList<(string Slug, string Name)>? _models;
    // Modèle choisi dans les paramètres ; vide ou absent du compte : le premier modèle proposé par OpenAI.
    public string PreferredModel { get; set; } = "";
    public IReadOnlyList<(string Slug, string Name)> Models => _models ?? [];
    public event Action? Changed;
    public bool SigningIn => _signIn != null;
    public string? Error { get; private set; }
    public ChatGptTokens? Tokens { get; private set; }
    // Une session d'identité seule ne suffit pas : il faut l'autorisation d'utiliser le forfait.
    public bool Ready => !AppPaths.Private && Tokens is { } t && ChatGptOAuth.HasPlan(t.Scopes);

    public ChatGptAccount(string? dataDir = null, HttpClient? http = null)
    {
        _http = http ?? DefaultHttp;
        _file = Path.Combine(dataDir ?? AppPaths.DataDir, "chatgpt.bin");
        _hostFile = Path.Combine(dataDir ?? AppPaths.DataDir, "chatgpt-host.txt");
        _lock = "Local\\Sol.ChatGPT." + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(_file.ToLowerInvariant())))[..16];
        if (!AppPaths.Private) Tokens = Load();
    }

    public async Task SignInAsync()
    {
        if (AppPaths.Private || _signIn != null) return;
        var cts = _signIn = new CancellationTokenSource(TimeSpan.FromMinutes(10));
        _cancelled = false;
        Error = null; Changed?.Invoke();
        var listener = new TcpListener(IPAddress.Loopback, 0);
        try
        {
            var registration = Registration();
            listener.Start();
            var redirect = $"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/auth/callback";
            string state = ChatGptOAuth.RandomValue(), nonce = ChatGptOAuth.RandomValue(), verifier = ChatGptOAuth.RandomValue();
            // Navigateur du système, comme le demande OpenAI : Sol ne voit jamais les identifiants.
            Process.Start(new ProcessStartInfo(ChatGptOAuth.AuthorizeUrl(HostId(), redirect, state, nonce, ChatGptOAuth.Challenge(verifier), registration, Tokens?.IdToken)) { UseShellExecute = true });
            var (code, clientId, scope) = await CallbackAsync(listener, redirect, state, registration?.ClientId, cts.Token);
            Locked(() => SaveRegistration(registration ?? new(clientId, null, "")));
            var body = await PostAsync(ChatGptOAuth.TokenEndpoint, new()
            {
                ["grant_type"] = "authorization_code", ["client_id"] = clientId, ["code"] = code,
                ["code_verifier"] = verifier, ["redirect_uri"] = redirect, ["resource"] = ChatGptOAuth.Resource,
            }, cts.Token);
            var fresh = ChatGptOAuth.ParseTokens(body, scope ?? "", DateTimeOffset.UtcNow);
            var (subject, email) = ChatGptOAuth.VerifyIdToken(fresh.IdToken ?? throw new ChatGptException("invalid-id-token"),
                (await DiscoverAsync(cts.Token)).Jwks, clientId, nonce, DateTimeOffset.UtcNow);
            if (registration?.Subject is { } expected && subject != expected) throw new ChatGptException("invalid-id-token");
            var tokens = new ChatGptTokens(clientId, subject, email, fresh.IdToken, fresh.Access, fresh.Refresh, fresh.Expires, fresh.Scopes);
            cts.Token.ThrowIfCancellationRequested();
            Locked(() => { cts.Token.ThrowIfCancellationRequested(); Save(tokens); SaveRegistration(new(clientId, subject, email)); });
            Tokens = tokens; _models = null;
            if (!ChatGptOAuth.HasPlan(tokens.Scopes)) Error = "plan-not-granted";
        }
        catch (ChatGptException e) { Error = e.Code; }
        catch (OperationCanceledException) { Error = _cancelled ? null : "signin-timeout"; }
        catch (Exception e) when (e is HttpRequestException or SocketException or IOException or JsonException or FormatException
            or KeyNotFoundException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            DebugLog.Write("chatgpt.signin " + e.GetType().Name);
            Error = e is FormatException { Message: "invalid-id-token" or "unknown-signing-key" } ? "invalid-id-token" : "signin-failed";
        }
        finally { listener.Stop(); _signIn = null; _cancelled = false; cts.Dispose(); Changed?.Invoke(); }
    }

    private bool _cancelled;
    public void CancelSignIn()
    {
        try { if (_signIn is { } pending) { _cancelled = true; pending.Cancel(); } } catch (ObjectDisposedException) { }
    }

    // Déconnexion : les jetons locaux disparaissent tout de suite, puis la session est révoquée chez OpenAI.
    public async Task SignOutAsync()
    {
        CancelSignIn();
        ChatGptTokens? tokens;
        try { tokens = Locked(() => { var saved = Load(); File.Delete(_file); return saved; }); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        { Error = "signout-failed"; Changed?.Invoke(); return; }
        Tokens = null; _models = null; Error = null; Changed?.Invoke();
        if (tokens == null) return;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                using var response = await _http.PostAsync((await DiscoverAsync(timeout.Token)).Revocation, new FormUrlEncodedContent(new Dictionary<string, string>
                    { ["token"] = tokens.RefreshToken, ["token_type_hint"] = "refresh_token", ["client_id"] = tokens.ClientId }), timeout.Token);
                if (response.IsSuccessStatusCode) return;
                if ((int)response.StatusCode < 500) break;
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or ChatGptException) { }
            await Task.Delay(300);
        }
        if (Tokens == null) { Error = "revocation-unconfirmed"; Changed?.Invoke(); }
    }

    public Task StreamAsync(string instructions, string input, Action<string> delta, CancellationToken ct) =>
        StreamAsync(instructions, [("user", input)], delta, ct);

    public Task StreamAsync(string instructions, IEnumerable<(string Role, string Text)> messages, Action<string> delta, CancellationToken ct) =>
        RunAsync(instructions, messages.Select(m => (object)new { role = m.Role, content = m.Text }).ToList(), null, null, delta, ct);

    // Réponse en flux ; avec des outils, chaque appel est exécuté par Sol puis renvoyé au modèle avec tout ce qu'il a
    // produit, jusqu'à une réponse finale. store:false : rien n'est conservé chez OpenAI, d'où le renvoi complet.
    public async Task RunAsync(string instructions, List<object> input, object[]? tools, Func<AgentCall, Task<string>>? execute, Action<string> delta, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromMinutes(5)); ct = deadline.Token;
        for (var round = 0; round < SolAiAgent.MaxRounds; round++)
        {
            var token = await AccessTokenAsync(ct);
            var model = await ModelAsync(token, ct);
            object body = tools is null
                ? new { model, instructions, input, store = false, stream = true }
                : new { model, instructions, input, tools, store = false, stream = true, include = new[] { "reasoning.encrypted_content" } };
            using var request = new HttpRequestMessage(HttpMethod.Post, ChatGptOAuth.Resource + "/responses") { Content = JsonContent.Create(body) };
            request.Headers.Authorization = new("Bearer", token);
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode)
                throw new ChatGptException(response.StatusCode == HttpStatusCode.Unauthorized ? "signed-out"
                    : ChatGptOAuth.ErrorCode(await response.Content.ReadAsStringAsync(ct), (int)response.StatusCode));
            var calls = new List<AgentCall>();
            var items = new List<object>();
            var completed = false;
            using (var reader = new StreamReader(await response.Content.ReadAsStreamAsync(ct)))
                while (!completed && await reader.ReadLineAsync(ct) is { } line)
                {
                    if (!line.StartsWith("data:", StringComparison.Ordinal) || line[5..].Trim() is not { Length: > 0 } data || data == "[DONE]") continue;
                    var (type, text, error) = ChatGptOAuth.StreamEvent(data);
                    if (error != null) throw new ChatGptException(error);
                    if (text.Length > 0) delta(text);
                    if (tools != null)
                    {
                        var (found, item) = SolAiAgent.OutputItem(data);
                        if (item is { } element) items.Add(element);
                        if (found != null) calls.Add(found);
                    }
                    completed = type == "response.completed";
                }
            if (!completed) throw new ChatGptException("incomplete");
            if (calls.Count == 0 || execute == null) return;
            input.AddRange(items);
            foreach (var call in calls) input.Add(new { type = "function_call_output", call_id = call.CallId, output = await execute(call) });
        }
        throw new ChatGptException("too-many-steps");
    }

    public async Task LoadModelsAsync(CancellationToken ct) { _models = null; await ModelAsync(await AccessTokenAsync(ct), ct); }

    private async Task<string> ModelAsync(string token, CancellationToken ct)
    {
        if (_models is null)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, ChatGptOAuth.Resource + "/models");
            request.Headers.Authorization = new("Bearer", token);
            using var response = await _http.SendAsync(request, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode) throw new ChatGptException(response.StatusCode == HttpStatusCode.Unauthorized ? "signed-out" : ChatGptOAuth.ErrorCode(body, (int)response.StatusCode));
            _models = ChatGptOAuth.Models(body);
        }
        return _models.Any(m => m.Slug == PreferredModel) ? PreferredModel : _models.Select(m => m.Slug).FirstOrDefault() ?? throw new ChatGptException("no-model");
    }

    // Jeton d'accès valide. Sérialisé en mémoire par _refreshGate (avec double vérification d'expiration) et entre
    // fenêtres par le mutex nommé _lock, car le jeton de renouvellement tourne et ne sert qu'une seule fois.
    private async Task<string> AccessTokenAsync(CancellationToken ct)
    {
        var current = Locked(Load) ?? throw new ChatGptException("signed-out");
        if (!ChatGptOAuth.HasPlan(current.Scopes)) { Tokens = current; Changed?.Invoke(); throw new ChatGptException("plan-not-granted"); }
        if (current.Expires > DateTimeOffset.UtcNow.AddMinutes(2)) { Tokens = current; return current.AccessToken; }

        await _refreshGate.WaitAsync(ct);
        try
        {
            var rechecked = Locked(Load) ?? throw new ChatGptException("signed-out");
            if (!ChatGptOAuth.HasPlan(rechecked.Scopes)) { Tokens = rechecked; Changed?.Invoke(); throw new ChatGptException("plan-not-granted"); }
            if (rechecked.Expires > DateTimeOffset.UtcNow.AddMinutes(2)) { Tokens = rechecked; return rechecked.AccessToken; }
            return await Task.Run(() => Locked(() => RefreshLocked(ct)), ct);
        }
        finally { _refreshGate.Release(); }
    }

    private string RefreshLocked(CancellationToken ct)
    {
        var tokens = Load() ?? throw new ChatGptException("signed-out");
        if (!ChatGptOAuth.HasPlan(tokens.Scopes)) { Tokens = tokens; Changed?.Invoke(); throw new ChatGptException("plan-not-granted"); }
        if (tokens.Expires > DateTimeOffset.UtcNow.AddMinutes(2)) { Tokens = tokens; return tokens.AccessToken; }
        string body;
        try
        {
            body = PostAsync(ChatGptOAuth.TokenEndpoint, new()
            {
                ["grant_type"] = "refresh_token", ["client_id"] = tokens.ClientId, ["refresh_token"] = tokens.RefreshToken, ["resource"] = ChatGptOAuth.Resource,
            }, ct).GetAwaiter().GetResult();
        }
        catch (ChatGptException e) when (e.Code is "invalid_grant" or "invalid_client" or "unauthorized_client" or "http-400" or "http-401")
        {
            try { File.Delete(_file); } catch (IOException) { }
            Tokens = null; Changed?.Invoke();
            throw new ChatGptException("signed-out");
        }
        var fresh = ChatGptOAuth.ParseTokens(body, tokens.Scopes, DateTimeOffset.UtcNow);
        // Conserver la rotation sans rendre utilisable un accès dont l’identité reste à vérifier.
        Save(tokens with { RefreshToken = fresh.Refresh, Expires = DateTimeOffset.MinValue });
        try
        {
            if (fresh.IdToken != null && ChatGptOAuth.VerifyIdToken(fresh.IdToken, DiscoverAsync(ct).GetAwaiter().GetResult().Jwks,
                    tokens.ClientId, null, DateTimeOffset.UtcNow).Subject != tokens.Subject) throw new FormatException("invalid-id-token");
        }
        catch (Exception e) when (e is FormatException or JsonException or KeyNotFoundException or CryptographicException)
        {
            File.Delete(_file); Tokens = null; Changed?.Invoke();
            throw new ChatGptException("invalid-id-token");
        }
        tokens = tokens with { AccessToken = fresh.Access, RefreshToken = fresh.Refresh, Expires = fresh.Expires, Scopes = fresh.Scopes, IdToken = fresh.IdToken ?? tokens.IdToken };
        Save(tokens);
        Tokens = tokens; Changed?.Invoke();
        if (!ChatGptOAuth.HasPlan(tokens.Scopes)) throw new ChatGptException("plan-not-granted");
        return tokens.AccessToken;
    }
}
