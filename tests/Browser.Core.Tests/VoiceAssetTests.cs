using System.Net;
using System.Security.Cryptography;
using Browser.Core;

namespace Browser.Core.Tests;

public class VoiceAssetTests
{
    [Fact]
    public async Task VerifiesBytesAtomicallyAndRejectsCorruptionEvenAtTheCorrectLength()
    {
        var path = Path.Combine(Path.GetTempPath(), "sol-voice-" + Guid.NewGuid());
        var data = "voice test weights"u8.ToArray();
        var asset = new VoiceAsset("model.gguf", "https://example.invalid/model", data.Length, Convert.ToHexString(SHA256.HashData(data)));
        try
        {
            using var http = new HttpClient(new BytesHandler(data));
            var store = new VoiceAssetStore(path, [asset], http);
            Assert.False(await store.CheckAsync(default));
            await store.InstallAsync(null, default);
            Assert.True(await store.CheckAsync(default));
            Assert.False(File.Exists(Path.Combine(path, "model.gguf.part")));
            await File.WriteAllBytesAsync(Path.Combine(path, "model.gguf"), new byte[data.Length]);
            Assert.False(await store.CheckAsync(default));
            using var badHttp = new HttpClient(new BytesHandler(new byte[data.Length]));
            await Assert.ThrowsAsync<InvalidDataException>(() => new VoiceAssetStore(path, [asset], badHttp).InstallAsync(null, default));
            Assert.False(File.Exists(Path.Combine(path, "model.gguf.part")));
        }
        finally { if (Directory.Exists(path)) Directory.Delete(path, true); }
    }
    [Fact]
    public async Task CancellationAndBusyInstallerNeverLeaveAcceptedWeights()
    {
        var path = Path.Combine(Path.GetTempPath(), "sol-voice-" + Guid.NewGuid());
        var data = new byte[20000];
        var asset = new VoiceAsset("model.gguf", "https://example.invalid/model", data.Length, Convert.ToHexString(SHA256.HashData(data)));
        try
        {
            using var http = new HttpClient(new BytesHandler(data));
            var store = new VoiceAssetStore(path, [asset], http);
            using var cancel = new CancellationTokenSource();
            cancel.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.InstallAsync(null, cancel.Token));
            Directory.CreateDirectory(path);
            using var lease = new FileStream(Path.Combine(path, "install.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            await Assert.ThrowsAsync<IOException>(() => store.InstallAsync(null, default));
            Assert.False(File.Exists(Path.Combine(path, "model.gguf")));
            Assert.DoesNotContain("voice-models", Backup.ProfileFolders);
        }
        finally { if (Directory.Exists(path)) Directory.Delete(path, true); }
    }
    private sealed class BytesHandler(byte[] bytes) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) });
    }
}
