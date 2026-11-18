using System.Buffers;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Browser.Core;

/// <summary>Paquets signés du Chrome Web Store. Aucune URL de téléchargement arbitraire.</summary>
public static class ExtensionPackage
{
    /// <summary>Services de paquets et de mises à jour du Chrome Web Store et de Microsoft Edge Add-ons.</summary>
    public const string StoreUpdates = "https://clients2.google.com/service/update2/crx";
    public const string EdgeStoreUpdates = "https://edge.microsoft.com/extensionwebstorebase/v1/crx";
    public const long MaxEntryBytes = 256L * 1024 * 1024;
    public const long MaxTotalBytes = 512L * 1024 * 1024;

    /// <summary>Un manifeste d'extension peut porter des commentaires et des virgules finales : les navigateurs les acceptent.</summary>
    public static readonly System.Text.Json.JsonDocumentOptions Lenient = new() { CommentHandling = System.Text.Json.JsonCommentHandling.Skip, AllowTrailingCommas = true };

    public static bool IsEdgeStore(string input) =>
        Uri.TryCreate(input.Trim(), UriKind.Absolute, out var url) && url.Scheme == "https"
        && url.Host == "microsoftedge.microsoft.com" && url.AbsolutePath.StartsWith("/addons/", StringComparison.Ordinal);

    public static string StoreId(string input)
    {
        if (!Uri.TryCreate(input.Trim(), UriKind.Absolute, out var url) || url.Scheme != "https"
            || !((url.Host == "chromewebstore.google.com" && url.AbsolutePath.StartsWith("/detail/", StringComparison.Ordinal))
                || (url.Host == "microsoftedge.microsoft.com" && url.AbsolutePath.StartsWith("/addons/detail/", StringComparison.Ordinal))))
            throw new ArgumentException("Ouvrez la fiche d’une extension sur le Chrome Web Store ou Microsoft Edge Add-ons.");
        var id = url.AbsolutePath.TrimEnd('/').Split('/').Last();
        return ExtensionCatalog.IsId(id) ? id : throw new ArgumentException("Identifiant d’extension invalide.");
    }

    public static Uri DownloadUri(string id, string version, bool edge = false)
    {
        if (!ExtensionCatalog.IsId(id) || !Version.TryParse(version, out _)) throw new ArgumentException("Extension ou moteur invalide.");
        var service = edge ? EdgeStoreUpdates : StoreUpdates;
        return new Uri($"{service}?response=redirect&prodversion={version}&acceptformat=crx3&x="
            + Uri.EscapeDataString($"id={id}&installsource=ondemand&uc"));
    }

    /// <summary>Demande au store la dernière version de chaque extension donnée.</summary>
    public static Uri UpdateCheckUri(IEnumerable<string> ids, string version, bool edge = false)
    {
        var asked = ids.Distinct().ToList();
        if (asked.Count == 0 || !asked.All(ExtensionCatalog.IsId) || !Version.TryParse(version, out _)) throw new ArgumentException("Extension ou moteur invalide.");
        var service = edge ? EdgeStoreUpdates : StoreUpdates;
        return new Uri($"{service}?response=updatecheck&prodversion={version}&acceptformat=crx3"
            + string.Concat(asked.Select(id => "&x=" + Uri.EscapeDataString($"id={id}&v=0&uc"))));
    }

    /// <summary>Lit la réponse du store : identifiant → dernière version publiée. Les extensions retirées du store n'y sont pas.</summary>
    public static Dictionary<string, Version> ParseUpdates(string xml)
    {
        var latest = new Dictionary<string, Version>();
        try
        {
            foreach (var app in System.Xml.Linq.XDocument.Parse(xml).Descendants().Where(e => e.Name.LocalName == "app"))
                if ((string?)app.Attribute("appid") is { } id && ExtensionCatalog.IsId(id)
                    && app.Elements().FirstOrDefault(e => e.Name.LocalName == "updatecheck") is { } check
                    && Version.TryParse((string?)check.Attribute("version"), out var version)) latest[id] = version;
        }
        catch (System.Xml.XmlException) { }
        return latest;
    }

    public static void Extract(byte[] package, string id, string destination)
    {
        using var stream = new MemoryStream(package, writable: false);
        Extract(stream, id, destination);
    }

    /// <summary>Vérifie et extrait sur disque, avec plafonds réels d'octets décompressés et sans copie du paquet en mémoire.</summary>
    public static void Extract(Stream package, string id, string destination) =>
        Extract(package, id, destination, MaxEntryBytes, MaxTotalBytes);

    public static void Extract(Stream package, string id, string destination, long maxEntryBytes, long maxTotalBytes)
    {
        if (!ExtensionCatalog.IsId(id) || !package.CanRead || !package.CanSeek || package.Length < 12)
            throw new InvalidDataException("Paquet CRX3 invalide.");
        try
        {
            package.Position = 0;
            Span<byte> prefix = stackalloc byte[12];
            package.ReadExactly(prefix);
            if (!prefix[..4].SequenceEqual("Cr24"u8) || BinaryPrimitives.ReadUInt32LittleEndian(prefix[4..]) != 3)
                throw new InvalidDataException("Paquet CRX3 invalide.");
            var headerSize = BinaryPrimitives.ReadUInt32LittleEndian(prefix[8..]);
            if (headerSize > 1024 * 1024 || headerSize >= package.Length - 12) throw new InvalidDataException("En-tête CRX3 invalide.");
            var envelope = new byte[(int)headerSize];
            package.ReadExactly(envelope);
            var header = Fields(envelope);
            var signed = header.SingleOrDefault(f => f.Tag == 10000).Data ?? throw new InvalidDataException("Signature absente.");
            var expected = Fields(signed).SingleOrDefault(f => f.Tag == 1).Data;
            if (expected is not { Length: 16 } || Id(expected) != id) throw new InvalidDataException("Le paquet ne correspond pas à cette extension.");
            var archiveOffset = 12 + (int)headerSize;
            var hash = ComputePayloadHash(package, signed);
            var key = VerifySignature(header, id, hash) ?? throw new InvalidDataException("Signature de l’extension invalide.");
            ExtractZip(package, archiveOffset, destination, maxEntryBytes, maxTotalBytes);
            var manifestPath = Path.Combine(destination, "manifest.json");
            if (!File.Exists(manifestPath)) throw new InvalidDataException("Manifeste absent.");
            var manifest = JsonNode.Parse(File.ReadAllText(manifestPath), null, Lenient)?.AsObject() ?? throw new InvalidDataException("Manifeste absent.");
            if (manifest["theme"] is not null) throw new InvalidDataException("C’est un thème pour Chrome : Sol n’installe que les extensions.");
            manifest["key"] = Convert.ToBase64String(key);
            File.WriteAllText(manifestPath, manifest.ToJsonString());
            if (ExtensionCatalog.Read(destination, id) is null) throw new InvalidDataException("Manifeste d’extension invalide.");
        }
        catch (Exception e) when (e is CryptographicException or OverflowException or InvalidOperationException or System.Text.Json.JsonException)
        {
            throw new InvalidDataException("Paquet CRX3 invalide.", e);
        }
    }

    private static byte[] ComputePayloadHash(Stream package, byte[] signed)
    {
        using var payload = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        payload.AppendData("CRX3 SignedData\0"u8);
        Span<byte> size = stackalloc byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(size, signed.Length);
        payload.AppendData(size);
        payload.AppendData(signed);
        var buffer = ArrayPool<byte>.Shared.Rent(65536);
        try
        {
            int count;
            while ((count = package.Read(buffer, 0, 65536)) != 0) payload.AppendData(buffer.AsSpan(0, count));
            return payload.GetHashAndReset();
        }
        finally { ArrayPool<byte>.Shared.Return(buffer); }
    }

    private static byte[]? VerifySignature(List<(int Tag, byte[] Data)> header, string id, byte[] hash)
    {
        foreach (var proof in header.Where(f => f.Tag is 2 or 3))
        {
            var fields = Fields(proof.Data);
            var publicKey = fields.SingleOrDefault(f => f.Tag == 1).Data;
            var signature = fields.SingleOrDefault(f => f.Tag == 2).Data;
            if (publicKey is null || signature is null || Id(SHA256.HashData(publicKey).AsSpan(0, 16)) != id) continue;
            bool valid;
            if (proof.Tag == 2)
            {
                using var rsa = RSA.Create(); rsa.ImportSubjectPublicKeyInfo(publicKey, out _);
                valid = rsa.VerifyHash(hash, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            }
            else
            {
                using var ec = ECDsa.Create(); ec.ImportSubjectPublicKeyInfo(publicKey, out _);
                valid = ec.VerifyHash(hash, signature, DSASignatureFormat.Rfc3279DerSequence);
            }
            if (valid) return publicKey;
        }
        return null;
    }

    private static void ExtractZip(Stream package, int archiveOffset, string destination, long maxEntryBytes, long maxTotalBytes)
    {
        using var archive = new ExtensionArchiveStream(package, archiveOffset);
        using var zip = new ZipArchive(archive, ZipArchiveMode.Read);
        var root = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (zip.Entries.Count > 20000) throw new InvalidDataException("Trop de fichiers dans l’extension.");
        long totalBytes = 0;
        var buffer = ArrayPool<byte>.Shared.Rent(81920);
        try
        {
            foreach (var entry in zip.Entries)
            {
                var target = Path.GetFullPath(Path.Combine(destination, entry.FullName));
                if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase) || entry.FullName.Contains(':') || !names.Add(target))
                    throw new InvalidDataException("Archive d’extension non sûre.");
                if (entry.FullName.EndsWith('/')) { Directory.CreateDirectory(target); continue; }
                if (entry.FullName.StartsWith("_metadata/", StringComparison.Ordinal)) continue;
                if (entry.Length > maxEntryBytes || entry.Length > maxTotalBytes - totalBytes)
                    throw new InvalidDataException("Extension décompressée trop volumineuse.");
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                long entryBytes = 0;
                try
                {
                    using var source = entry.Open();
                    using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    int read;
                    while ((read = source.Read(buffer, 0, 81920)) > 0)
                    {
                        entryBytes += read; totalBytes += read;
                        if (entryBytes > maxEntryBytes || totalBytes > maxTotalBytes)
                            throw new InvalidDataException("Extension décompressée trop volumineuse.");
                        output.Write(buffer, 0, read);
                    }
                    if (entry.Length < 0 || entryBytes != entry.Length)
                        throw new InvalidDataException("Taille d’entrée d’extension incohérente.");
                }
                catch { if (File.Exists(target)) File.Delete(target); throw; }
            }
        }
        finally { ArrayPool<byte>.Shared.Return(buffer); }
    }

    private static string Id(ReadOnlySpan<byte> bytes)
    {
        var chars = new char[bytes.Length * 2];
        for (var i = 0; i < bytes.Length; i++) { chars[2 * i] = (char)('a' + (bytes[i] >> 4)); chars[2 * i + 1] = (char)('a' + (bytes[i] & 15)); }
        return new string(chars);
    }

    private static List<(int Tag, byte[] Data)> Fields(byte[] bytes)
    {
        var result = new List<(int, byte[])>();
        var at = 0;
        ulong Varint()
        {
            ulong value = 0;
            for (var shift = 0; shift < 64 && at < bytes.Length; shift += 7)
            { var b = bytes[at++]; value |= (ulong)(b & 127) << shift; if (b < 128) return value; }
            throw new InvalidDataException("En-tête protobuf invalide.");
        }
        while (at < bytes.Length)
        {
            var field = Varint(); var wire = field & 7;
            if (wire == 0) { Varint(); continue; }
            var length = wire switch { 1 => 8, 5 => 4, 2 => checked((int)Varint()), _ => throw new InvalidDataException("Champ CRX3 invalide.") };
            if (length > bytes.Length - at) throw new InvalidDataException("En-tête tronqué.");
            if (wire == 2) result.Add((checked((int)(field >> 3)), bytes.AsSpan(at, length).ToArray()));
            at += length;
        }
        return result;
    }
}
