using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using Browser.Core;

public class ExtensionPackageTests
{
    [Fact]
    public void Background_script_starts_with_the_tab_view_of_a_single_window_browser()
    {
        var folder = Path.Combine(Path.GetTempPath(), "sol-shim-" + Guid.NewGuid());
        Directory.CreateDirectory(Path.Combine(folder, "js"));
        try
        {
            var manifest = Path.Combine(folder, "manifest.json");
            File.WriteAllText(manifest, """{ "manifest_version": 3, "name": "T", "version": "1", "key": "k", "background": { "service_worker": "js/bg.js" } }""");
            Assert.True(ExtensionShim.Apply(folder));
            Assert.Equal("importScripts('/sol-tabs.js', \"bg.js\");\n", File.ReadAllText(Path.Combine(folder, "js", "sol-worker.js")));
            Assert.Contains("\"service_worker\":\"js/sol-worker.js\"", File.ReadAllText(manifest));
            Assert.Contains("\"key\":\"k\"", File.ReadAllText(manifest));
            Assert.Equal(ExtensionShim.Script, File.ReadAllText(Path.Combine(folder, "sol-tabs.js")));
            Assert.False(ExtensionShim.Apply(folder)); // déjà en place : rien à recharger
            File.WriteAllText(Path.Combine(folder, "sol-tabs.js"), "ancien");
            Assert.True(ExtensionShim.Apply(folder));  // script d'une version précédente : remplacé

            File.WriteAllText(manifest, """{ "manifest_version": 3, "name": "T", "version": "1", "background": { "service_worker": "bg.js", "type": "module" } }""");
            Assert.True(ExtensionShim.Apply(folder));
            Assert.Equal("import '/sol-tabs.js';\nimport \"./bg.js\";\n", File.ReadAllText(Path.Combine(folder, "sol-worker.js")));

            File.WriteAllText(manifest, """{ "manifest_version": 3, "name": "T", "version": "1" }""");
            Assert.False(ExtensionShim.Apply(folder)); // pas de script de fond
        }
        finally { Directory.Delete(folder, true); }
    }

    [Fact]
    public void Store_update_answer_gives_the_latest_version_of_each_published_extension()
    {
        const string dark = "eimadpbcbfnmbkopoojfekhnkhdbieeh", gone = "pejdijmoenmkgeppbflobdenhhabjlaj";
        var latest = ExtensionPackage.ParseUpdates($"""
            <?xml version="1.0" encoding="UTF-8"?><gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
            <app appid="{dark}" status="ok"><updatecheck codebase="https://example.test/a.crx" status="ok" version="4.9.133"/></app>
            <app appid="{gone}" status="ok"><updatecheck status="noupdate"/></app><app appid="not-an-id"><updatecheck version="9.9"/></app></gupdate>
            """);
        Assert.Equal(new Version(4, 9, 133), Assert.Single(latest).Value);
        Assert.Empty(ExtensionPackage.ParseUpdates("<html>erreur"));
        var asked = ExtensionPackage.UpdateCheckUri([dark, gone], "140.0.1.2").AbsoluteUri;
        Assert.StartsWith(ExtensionPackage.StoreUpdates + "?response=updatecheck", asked);
        Assert.Contains(Uri.EscapeDataString($"id={gone}&v=0&uc"), asked);
        Assert.Throws<ArgumentException>(() => ExtensionPackage.UpdateCheckUri(["https://evil.test"], "140.0.1.2"));
    }

    [Fact]
    public void Requested_access_is_described_in_plain_words()
    {
        Assert.Equal(["Lire et modifier toutes vos données sur tous les sites web"],
            ExtensionPermissions.Describe(["alarms", "storage", "scripting", "*://*/*", "https://exemple.fr/*"], french: true));
        Assert.Equal(["Read and change your data on exemple.fr, github.com", "Read your browsing history", "futurePermission"],
            ExtensionPermissions.Describe(["tabs", "https://*.exemple.fr/*", "https://github.com/*", "webNavigation", "futurePermission"], french: false));
        Assert.Empty(ExtensionPermissions.Describe(["storage", "activeTab"], french: true));
    }

    [Fact]
    public void Manifest_with_comments_is_read_with_its_site_access_and_store_origin()
    {
        var folder = Path.Combine(Path.GetTempPath(), "sol-manifest-" + Guid.NewGuid());
        Directory.CreateDirectory(folder);
        try
        {
            File.WriteAllText(Path.Combine(folder, "manifest.json"), """
                // en-tête
                { "manifest_version": 3, "name": "Test", "version": "1.2", "permissions": ["storage"],
                  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["a.js"] }],
                  "update_url": "https://clients2.google.com/service/update2/crx", }
                """);
            var info = ExtensionCatalog.Read(folder, "eimadpbcbfnmbkopoojfekhnkhdbieeh")!;
            Assert.True(info.Store);
            Assert.False(ExtensionCatalog.IsEdgeStore(folder));
            Assert.Equal(["storage", "<all_urls>"], info.Permissions!);
            ExtensionCatalog.EnsureKey(folder);
            Assert.Contains("\"key\"", File.ReadAllText(Path.Combine(folder, "manifest.json")));

            var devSource = folder + "-dev";
            Directory.CreateDirectory(devSource);
            try
            {
                File.WriteAllText(Path.Combine(devSource, "manifest.json"), """{"manifest_version":3,"name":"Dev v2","version":"2.0","action":{"default_popup":"p.html"}}""");
                ExtensionCatalog.SaveSource(folder, devSource);
                Assert.True(ExtensionCatalog.RefreshFromSource(folder));
                var marker = ExtensionAction.Marker(folder);
                Assert.NotNull(marker);
                Assert.True(ExtensionCatalog.RefreshFromSource(folder));
                Assert.Equal(devSource, ExtensionCatalog.SourceFolder(folder));
                Assert.Equal(marker, ExtensionAction.Marker(folder));
                Assert.Equal("2.0", ExtensionCatalog.Read(folder, "eimadpbcbfnmbkopoojfekhnkhdbieeh")!.Version);
            }
            finally { if (Directory.Exists(devSource)) Directory.Delete(devSource, true); }
        }
        finally { Directory.Delete(folder, true); }
    }

    [Fact]
    public void Signed_store_package_preserves_identity_and_rejects_tampering_and_unsafe_paths()
    {
        using var key = RSA.Create(2048);
        var publicKey = key.ExportSubjectPublicKeyInfo();
        var digest = SHA256.HashData(publicKey)[..16];
        var id = string.Concat(digest.SelectMany(b => new[] { (char)('a' + (b >> 4)), (char)('a' + (b & 15)) }));
        var directory = Path.Combine(Path.GetTempPath(), "sol-extension-" + Guid.NewGuid());
        byte[] Field(int tag, byte[] data)
        {
            using var result = new MemoryStream();
            void Varint(uint value) { while (value >= 128) { result.WriteByte((byte)(value | 128)); value >>= 7; } result.WriteByte((byte)value); }
            Varint((uint)((tag << 3) | 2)); Varint((uint)data.Length); result.Write(data);
            return result.ToArray();
        }
        byte[] Package(string name)
        {
            using var archive = new MemoryStream();
            using (var zip = new ZipArchive(archive, ZipArchiveMode.Create, true))
            {
                using var writer = new StreamWriter(zip.CreateEntry(name).Open());
                writer.Write("{\"manifest_version\":3,\"name\":\"Test\",\"version\":\"1.0\"}");
            }
            var signed = Field(1, digest);
            var payload = "CRX3 SignedData\0"u8.ToArray().Concat(BitConverter.GetBytes(signed.Length)).Concat(signed).Concat(archive.ToArray()).ToArray();
            var signature = key.SignData(payload, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            var proof = Field(1, publicKey).Concat(Field(2, signature)).ToArray();
            var header = Field(2, proof).Concat(Field(10000, signed)).ToArray();
            return "Cr24"u8.ToArray().Concat(BitConverter.GetBytes(3)).Concat(BitConverter.GetBytes(header.Length)).Concat(header).Concat(archive.ToArray()).ToArray();
        }
        try
        {
            var package = Package("manifest.json");
            ExtensionPackage.Extract(package, id, directory);
            using var manifest = System.Text.Json.JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "manifest.json")));
            Assert.Equal(Convert.ToBase64String(publicKey), manifest.RootElement.GetProperty("key").GetString());
            Assert.Equal(id, ExtensionPackage.StoreId($"https://chromewebstore.google.com/detail/test/{id}?hl=fr"));
            Assert.Equal(id, ExtensionPackage.StoreId($"https://microsoftedge.microsoft.com/addons/detail/test/{id}"));
            Assert.True(ExtensionPackage.IsEdgeStore($"https://microsoftedge.microsoft.com/addons/detail/test/{id}"));
            Assert.StartsWith(ExtensionPackage.EdgeStoreUpdates, ExtensionPackage.DownloadUri(id, "140.0.1.2", edge: true).AbsoluteUri);
            Assert.Throws<ArgumentException>(() => ExtensionPackage.StoreId($"https://chromewebstore.google.com.evil.test/detail/{id}"));
            package[^1] ^= 1;
            Assert.Throws<InvalidDataException>(() => ExtensionPackage.Extract(package, id, directory + "-bad"));
            Assert.Throws<InvalidDataException>(() => ExtensionPackage.Extract(Package("../outside.json"), id, directory + "-bad"));
            Assert.False(File.Exists(Path.Combine(Path.GetDirectoryName(directory)!, "outside.json")));
            ExtensionCatalog.CopyTo(directory, directory + "-copy");
            Assert.Equal(File.ReadAllText(Path.Combine(directory, "manifest.json")), File.ReadAllText(Path.Combine(directory + "-copy", "manifest.json")));
            Assert.Throws<ArgumentException>(() => ExtensionCatalog.CopyTo(directory, Path.Combine(directory, "nested")));
        }
        finally
        {
            foreach (var folder in new[] { directory, directory + "-copy", directory + "-bad" })
                if (Directory.Exists(folder)) Directory.Delete(folder, true);
        }
    }

    [Fact]
    public void Zip_bomb_with_forged_entry_length_and_malformed_crx_headers_are_rejected_as_invalid_data()
    {
        using var key = RSA.Create(2048);
        var publicKey = key.ExportSubjectPublicKeyInfo();
        var digest = SHA256.HashData(publicKey)[..16];
        var id = string.Concat(digest.SelectMany(b => new[] { (char)('a' + (b >> 4)), (char)('a' + (b & 15)) }));
        byte[] Field(int tag, byte[] data)
        {
            using var result = new MemoryStream();
            void Varint(uint value) { while (value >= 128) { result.WriteByte((byte)(value | 128)); value >>= 7; } result.WriteByte((byte)value); }
            Varint((uint)((tag << 3) | 2)); Varint((uint)data.Length); result.Write(data);
            return result.ToArray();
        }
        using var archive = new MemoryStream();
        using (var zip = new ZipArchive(archive, ZipArchiveMode.Create, true))
        {
            using (var w = new StreamWriter(zip.CreateEntry("manifest.json").Open()))
                w.Write("{\"manifest_version\":3,\"name\":\"Bomb\",\"version\":\"1.0\"}");
            using var bomb = zip.CreateEntry("bomb.bin", CompressionLevel.Fastest).Open();
            bomb.Write(new byte[512 * 1024]); // 512 Kio réels compressés en ~600 octets
        }
        var rawZip = archive.ToArray();
        // Forge un extra field ZIP64 (0x0001) annonçant uncompressedSize = -1 afin que entry.Length == -1 contourne
        // un simple filtre entry.Length > MaxEntryBytes tout en laissant DeflateStream décompresser les 512 Kio réels.
        var zipBytes = ForgeZip64NegativeLength(rawZip, "bomb.bin");
        using (var check = new ZipArchive(new MemoryStream(zipBytes), ZipArchiveMode.Read))
            Assert.Equal(-1L, check.GetEntry("bomb.bin")!.Length);

        var signed = Field(1, digest);
        var payload = "CRX3 SignedData\0"u8.ToArray().Concat(BitConverter.GetBytes(signed.Length)).Concat(signed).Concat(zipBytes).ToArray();
        var signature = key.SignData(payload, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var proof = Field(1, publicKey).Concat(Field(2, signature)).ToArray();
        var header = Field(2, proof).Concat(Field(10000, signed)).ToArray();
        var crx = "Cr24"u8.ToArray().Concat(BitConverter.GetBytes(3)).Concat(BitConverter.GetBytes(header.Length)).Concat(header).Concat(zipBytes).ToArray();

        var dir = Path.Combine(Path.GetTempPath(), "sol-bomb-" + Guid.NewGuid());
        try
        {
            using var stream = new MemoryStream(crx, writable: false);
            var bombEx = Assert.Throws<InvalidDataException>(() => ExtensionPackage.Extract(stream, id, dir, maxEntryBytes: 64 * 1024, maxTotalBytes: 128 * 1024));
            Assert.Contains("volumineuse", bombEx.Message);
            Assert.False(File.Exists(Path.Combine(dir, "bomb.bin")));

            // Champs protobuf signés dupliqués -> InvalidDataException (pas InvalidOperationException).
            var duplicateHeader = Field(2, proof).Concat(Field(10000, signed)).Concat(Field(10000, signed)).ToArray();
            var malformedCrx = "Cr24"u8.ToArray().Concat(BitConverter.GetBytes(3)).Concat(BitConverter.GetBytes(duplicateHeader.Length)).Concat(duplicateHeader).Concat(rawZip).ToArray();
            Assert.Throws<InvalidDataException>(() => ExtensionPackage.Extract(malformedCrx, id, dir + "-dup"));
        }
        finally
        {
            foreach (var d in new[] { dir, dir + "-dup" }) if (Directory.Exists(d)) Directory.Delete(d, true);
        }
    }

    private static byte[] ForgeZip64NegativeLength(byte[] zipBytes, string entryName)
    {
        var nameBytes = Encoding.ASCII.GetBytes(entryName);
        byte[] extra = [0x01, 0x00, 0x08, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
        for (var i = 0; i <= zipBytes.Length - 46 - nameBytes.Length; i++)
        {
            if (System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(zipBytes.AsSpan(i, 4)) != 0x02014b50) continue;
            var fnLen = System.Buffers.Binary.BinaryPrimitives.ReadUInt16LittleEndian(zipBytes.AsSpan(i + 28, 2));
            if (fnLen != nameBytes.Length || !zipBytes.AsSpan(i + 46, fnLen).SequenceEqual(nameBytes)) continue;
            var oldExtraLen = System.Buffers.Binary.BinaryPrimitives.ReadUInt16LittleEndian(zipBytes.AsSpan(i + 30, 2));
            var forged = new byte[zipBytes.Length + extra.Length];
            var insertAt = i + 46 + fnLen + oldExtraLen;
            zipBytes.AsSpan(0, insertAt).CopyTo(forged);
            extra.CopyTo(forged.AsSpan(insertAt));
            zipBytes.AsSpan(insertAt).CopyTo(forged.AsSpan(insertAt + extra.Length));
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(forged.AsSpan(i + 24, 4), 0xFFFFFFFF);
            System.Buffers.Binary.BinaryPrimitives.WriteUInt16LittleEndian(forged.AsSpan(i + 30, 2), (ushort)(oldExtraLen + extra.Length));
            var eocd = forged.Length - 22;
            var cdSize = System.Buffers.Binary.BinaryPrimitives.ReadUInt32LittleEndian(forged.AsSpan(eocd + 12, 4));
            System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(forged.AsSpan(eocd + 12, 4), (uint)(cdSize + extra.Length));
            return forged;
        }
        throw new InvalidOperationException("Entry not found");
    }

    [Fact]
    public void Malicious_default_locale_cannot_escape_locales_directory_and_lenient_json_is_supported()
    {
        var root = Path.Combine(Path.GetTempPath(), "sol-locale-" + Guid.NewGuid());
        var ext = Path.Combine(root, "sub", "ext");
        Directory.CreateDirectory(Path.Combine(ext, "_locales", "en"));
        try
        {
            // Fichier messages.json piégé hors de _locales que "../../" tenterait de lire.
            File.WriteAllText(Path.Combine(root, "messages.json"), """{ "appName": { "message": "FUITE EXTERNE" } }""");
            File.WriteAllText(Path.Combine(ext, "_locales", "en", "messages.json"), """
                // commentaire accepté
                { "appName": { "message": "Nom Sûr", }, }
                """);
            File.WriteAllText(Path.Combine(ext, "manifest.json"), """
                { "manifest_version": 3, "name": "__MSG_appName__", "version": "1.0", "default_locale": "../../", "icons": { "16": "icon.png", }, }
                """);
            File.WriteAllBytes(Path.Combine(ext, "icon.png"), [137, 80, 78, 71, 13, 10, 26, 10]);

            var info = ExtensionCatalog.Read(ext, "eimadpbcbfnmbkopoojfekhnkhdbieeh")!;
            Assert.Equal("Nom Sûr", info.Name);
            Assert.StartsWith("data:image/png;base64,", ExtensionCatalog.Icon(ext));
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
