using System.Text.Json;

namespace Browser.Core;

public static class SolAiDiagnostics
{
    public static string Clip(string text, int maximum)
    {
        var safe = NetworkTools.Redact(text);
        return safe.Length > maximum ? safe[..maximum] + "…" : safe;
    }

    public static string Report(string export, string query, bool errorsOnly)
    {
        using var json = JsonDocument.Parse(export);
        static string Text(JsonElement item, string key) =>
            item.ValueKind == JsonValueKind.Object && item.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        static int Int(JsonElement item, string key) =>
            item.ValueKind == JsonValueKind.Object && item.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : 0;
        static long Long(JsonElement item, string key) =>
            item.ValueKind == JsonValueKind.Object && item.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : 0;
        static JsonElement[] Items(JsonElement root, string key) =>
            root.ValueKind == JsonValueKind.Object && root.TryGetProperty(key, out var list) && list.ValueKind == JsonValueKind.Array
                ? list.EnumerateArray().ToArray() : [];

        var requests = Items(json.RootElement, "requests").Where(request =>
            (!errorsOnly || Int(request, "status") >= 400 || Text(request, "failed").Length > 0)
            && (Text(request, "url") + " " + Text(request, "method") + " " + Text(request, "failed")).Contains(query, StringComparison.OrdinalIgnoreCase)).ToArray();
        var console = Items(json.RootElement, "console").Where(line =>
            (!errorsOnly || Text(line, "level") is "error" or "warning" or "warn" or "assert")
            && Text(line, "text").Contains(query, StringComparison.OrdinalIgnoreCase)).ToArray();

        return JsonSerializer.Serialize(new
        {
            ok = true,
            requests = requests.TakeLast(25).Select(request => new
            {
                id = Text(request, "id"),
                method = Text(request, "method"),
                url = Clip(NetworkTools.SafeUrl(Text(request, "url")), 300),
                status = Int(request, "status"),
                type = Text(request, "type"),
                failed = Clip(Text(request, "failed"), 200),
                durationMs = request.ValueKind == JsonValueKind.Object && request.TryGetProperty("durationMs", out var duration) ? (object?)duration.Clone() : null,
                size = Long(request, "size"),
            }),
            console = console.TakeLast(15).Select(line => new { level = Text(line, "level"), text = Clip(Text(line, "text"), 700) }),
            matchingRequests = requests.Length,
            matchingMessages = console.Length,
            truncated = requests.Length > 25 || console.Length > 15,
            note = "Only captured events are available. Start capture before reproducing. A pending status 0 does not prove a failure; response mocks may affect results.",
        });
    }
}
