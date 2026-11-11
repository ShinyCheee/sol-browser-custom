using System.Security.Cryptography;
using System.Text.Json;

namespace Browser.Core;

public sealed record VoiceAsset(string Name, string Url, long Bytes, string Sha256);

public sealed class VoiceAssetStore(string directory, IReadOnlyList<VoiceAsset> assets, HttpClient http)
{
    public static IReadOnlyList<VoiceAsset> Catalog { get; } = LoadCatalog();
    public static IReadOnlyList<VoiceAsset> ForLanguage(string language) => Catalog.Where(a =>
        a.Name.EndsWith(".gguf") || a.Name.StartsWith(language == "fr" ? "fr_FR-" : "en_US-", StringComparison.Ordinal)).ToArray();
    private static IReadOnlyList<VoiceAsset> LoadCatalog()
    {
        using var stream = typeof(VoiceAssetStore).Assembly.GetManifestResourceStream("Browser.Core.VoiceModels.json")!;
        return JsonSerializer.Deserialize<VoiceAsset[]>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
    }
    public async Task<bool> CheckAsync(CancellationToken ct)
    {
        foreach (var asset in assets) if (!await ValidAsync(Path.Combine(directory, asset.Name), asset, ct)) return false;
        return true;
    }
    public async Task InstallAsync(Action<double>? progress, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        Directory.CreateDirectory(directory);
        // The OS releases this lease on crash. Never delete lock files (unlink/recreate races).
        using var lease = new FileStream(Path.Combine(directory, "install.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        var total = assets.Sum(a => a.Bytes);
        long completed = 0;
        foreach (var asset in assets)
        {
            var destination = Path.Combine(directory, asset.Name);
            if (await ValidAsync(destination, asset, ct)) { completed += asset.Bytes; progress?.Invoke((double)completed / total); continue; }
            var temporary = destination + ".part";
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, asset.Url);
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
                response.EnsureSuccessStatusCode();
                if (response.Content.Headers.ContentLength is { } size && size != asset.Bytes) throw new InvalidDataException("voice-size");
                await using (var input = await response.Content.ReadAsStreamAsync(ct))
                await using (var output = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None, 65536, true))
                {
                    var buffer = new byte[65536];
                    long received = 0;
                    while (await input.ReadAsync(buffer, ct) is var count && count > 0)
                    {
                        received += count;
                        if (received > asset.Bytes) throw new InvalidDataException("voice-size");
                        await output.WriteAsync(buffer.AsMemory(0, count), ct);
                        progress?.Invoke((double)(completed + received) / total);
                    }
                    await output.FlushAsync(ct);
                }
                if (!await ValidAsync(temporary, asset, ct)) throw new InvalidDataException("voice-digest");
                ct.ThrowIfCancellationRequested();
                File.Move(temporary, destination, true);
                completed += asset.Bytes;
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        progress?.Invoke(1);
    }
    private static async Task<bool> ValidAsync(string path, VoiceAsset asset, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (!File.Exists(path) || new FileInfo(path).Length != asset.Bytes) return false;
        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, true);
        return Convert.ToHexString(await SHA256.HashDataAsync(file, ct)).Equals(asset.Sha256, StringComparison.OrdinalIgnoreCase);
    }
}
