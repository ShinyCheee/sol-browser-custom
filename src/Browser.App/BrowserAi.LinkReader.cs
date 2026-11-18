using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Browser.Core;
using Microsoft.Web.WebView2.Core;

namespace Browser.App;

public sealed partial class BrowserController
{
    private const int MaxExternalLinkRedirects = 5;
    private const int MaxExternalLinkBytes = 2_000_000;

    private static readonly HttpClient SafeLinkHttp = new(new SocketsHttpHandler
    {
        UseCookies = false,
        AllowAutoRedirect = false,
        AutomaticDecompression = DecompressionMethods.All,
        ConnectCallback = ConnectPublicHostAsync,
    })
    { Timeout = TimeSpan.FromSeconds(15) };

    private async Task<string> ReadExternalLinkAsync(CoreWebView2 core, string external, CancellationToken ct)
    {
        var listed = JsonSerializer.Deserialize<string[]>(await EvaluateAsync(core, "A.links()")) ?? [];
        if (!listed.Contains(external) || !Uri.TryCreate(external, UriKind.Absolute, out var link)
            || link.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(link.UserInfo))
            return """{"ok":false,"error":"only links listed by read_page can be read on other sites"}""";

        var current = link;
        for (var hop = 0; hop <= MaxExternalLinkRedirects; hop++)
        {
            if (IsForbiddenLinkTarget(current))
                return """{"ok":false,"error":"private or local network addresses cannot be read"}""";

            using var response = await SafeLinkHttp.GetAsync(current, HttpCompletionOption.ResponseHeadersRead, ct);
            if ((int)response.StatusCode is >= 300 and < 400 && response.Headers.Location is { } location)
            {
                if (hop == MaxExternalLinkRedirects || !Uri.TryCreate(current, location, out var next)
                    || next.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(next.UserInfo))
                    return """{"ok":false,"error":"redirect blocked or limit exceeded"}""";
                current = next;
                continue;
            }

            var type = response.Content.Headers.ContentType?.MediaType ?? "";
            if (!type.Contains("html", StringComparison.OrdinalIgnoreCase) && !type.StartsWith("text/", StringComparison.OrdinalIgnoreCase))
                return JsonSerializer.Serialize(new { ok = false, error = "not a text page: " + type });

            var body = await ReadBoundedTextAsync(response.Content, MaxExternalLinkBytes, ct);
            return JsonSerializer.Serialize(new { ok = response.IsSuccessStatusCode, url = current.AbsoluteUri, text = SolAiAgent.HtmlText(body) });
        }

        return """{"ok":false,"error":"redirect limit exceeded"}""";
    }

    private static async Task<string> ReadBoundedTextAsync(HttpContent content, int maxBytes, CancellationToken ct)
    {
        using var stream = await content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[16384];
        int read;
        while (buffer.Length < maxBytes && (read = await stream.ReadAsync(chunk.AsMemory(0, (int)Math.Min(chunk.Length, maxBytes - buffer.Length)), ct)) > 0)
            buffer.Write(chunk, 0, read);
        var charset = content.Headers.ContentType?.CharSet?.Trim('"');
        Encoding encoding = Encoding.UTF8;
        if (!string.IsNullOrWhiteSpace(charset))
        {
            try { encoding = Encoding.GetEncoding(charset); }
            catch (ArgumentException) { }
        }
        return encoding.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }

    private static async ValueTask<Stream> ConnectPublicHostAsync(SocketsHttpConnectionContext context, CancellationToken ct)
    {
        var host = context.DnsEndPoint.Host;
        if (IsForbiddenHostName(host)) throw new HttpRequestException("Private or local host refused.");
        var addresses = IPAddress.TryParse(host.Trim('[', ']'), out var literal)
            ? [literal]
            : await Dns.GetHostAddressesAsync(host, ct);
        if (addresses.Length == 0 || addresses.Any(IsPrivateOrReservedIp))
            throw new HttpRequestException("Private or local IP address refused.");

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, ct);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    internal static bool IsForbiddenLinkTarget(Uri uri) =>
        uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo) || IsForbiddenHostName(uri.DnsSafeHost);

    private static bool IsForbiddenHostName(string host)
    {
        var clean = host.Trim().Trim('[', ']').TrimEnd('.');
        if (clean.Length == 0) return true;
        if (clean.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || clean.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)
            || clean.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
            return true;
        return IPAddress.TryParse(clean, out var ip) && IsPrivateOrReservedIp(ip);
    }

    internal static bool IsPrivateOrReservedIp(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            return b[0] == 0
                || b[0] == 10
                || (b[0] == 100 && (b[1] & 0xC0) == 64)
                || b[0] == 127
                || (b[0] == 169 && b[1] == 254)
                || (b[0] == 172 && b[1] is >= 16 and <= 31)
                || (b[0] == 192 && b[1] == 0 && (b[2] == 0 || b[2] == 2))
                || (b[0] == 192 && b[1] == 168)
                || (b[0] == 198 && b[1] is 18 or 19)
                || b[0] >= 224;
        }
        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (IPAddress.IsLoopback(ip) || ip.Equals(IPAddress.IPv6Any) || ip.Equals(IPAddress.IPv6None)) return true;
            var b = ip.GetAddressBytes();
            return (b[0] & 0xFE) == 0xFC
                || (b[0] == 0xFE && (b[1] & 0xC0) == 0x80)
                || b[0] == 0xFF
                || (b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0D && b[3] == 0xB8);
        }
        return true;
    }
}
