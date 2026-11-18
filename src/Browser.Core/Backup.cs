using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace Browser.Core;

/// <summary>
/// Fichier de sauvegarde d'un profil : ses fichiers, compressés puis chiffrés (AES-256-GCM) avec une clé tirée de la
/// clé de sauvegarde choisie par l'utilisateur (PBKDF2-SHA256). Sans cette clé, le fichier est illisible.
/// La restauration est d'abord mise de côté, puis appliquée au démarrage suivant, quand aucun
/// fichier du profil n'est encore ouvert.
/// </summary>
public static partial class Backup
{
    /// <summary>Les fichiers d'un profil qu'une sauvegarde contient et qu'une restauration a le droit de remplacer.</summary>
    public static readonly string[] ProfileFiles = ["settings.json", "session.json", "permissions.json", "browser.db", "notes.json", "notes-assets.json",
        "tab-sessions.json", "tab-sessions.json.sites.json", "workspaces.json", "downloads.json", "extension-state.json", "ai-categories.json", "wallpaper.jpg"];
    /// <summary>Dossiers repris en entier : les extensions installées, les autorisations de sessions et les pièces jointes des notes.</summary>
    public static readonly string[] ProfileFolders = ["extensions", "session-permissions", "notes-assets"];

    private static readonly HashSet<string> ReservedNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    /// <summary>Un nom de la sauvegarde qu'une restauration a le droit d'écrire : un fichier connu, ou un chemin simple dans un dossier connu.</summary>
    public static bool Allowed(string name)
    {
        if (ProfileFiles.Contains(name) || name is Passwords or Manifest) return true;
        var parts = name.Split('/');
        return parts.Length > 1 && ProfileFolders.Contains(parts[0]) && parts.All(ValidSegment);
    }

    private static bool ValidSegment(string part) =>
        part.Length > 0 && part is not ("." or "..") && part[^1] is not (' ' or '.')
        && part.IndexOfAny(Path.GetInvalidFileNameChars()) < 0
        && !part.Any(c => char.IsControl(c) || c is '<' or '>' or ':' or '"' or '\\' or '|' or '?' or '*')
        && !ReservedNames.Contains(part.Split('.', 2)[0].TrimEnd(' '));

    /// <summary>Les fichiers du profil à sauvegarder, sauf la base (copiée à part pendant qu'elle est ouverte) et les mots de passe.</summary>
    public static Dictionary<string, byte[]> Collect(string dataDir)
    {
        var (paths, manifest) = ProfileContent(dataDir);
        var files = paths.ToDictionary(pair => pair.Key, pair => ReadSharedBytes(pair.Value));
        files[Manifest] = manifest;
        return files;
    }

    private static byte[] ReadSharedBytes(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return copy.ToArray();
    }

    public const string Passwords = "passwords.json";
    public const int MinKeyLength = 8;
    public const int MaxSealedBytes = 256 * 1024 * 1024;
    public const int MaxEntryBytes = 256 * 1024 * 1024;
    public const int MaxExpandedBytes = 512 * 1024 * 1024;
    public const int MaxEntries = 10_000;

    private static readonly byte[] Magic = "SOLBACKUP1"u8.ToArray();
    private const int Salt = 16, Nonce = 12, Tag = 16, Iterations = 600_000;

    public static byte[] Seal(IReadOnlyDictionary<string, byte[]> files, string key)
    {
        long expanded = 0;
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (files.Count > MaxEntries) throw new InvalidDataException("La sauvegarde contient trop de fichiers.");
        foreach (var (name, bytes) in files)
        {
            if (bytes.Length > MaxEntryBytes || bytes.Length > MaxExpandedBytes - expanded)
                throw new InvalidDataException("Le contenu de la sauvegarde dépasse la taille restaurable.");
            if (Allowed(name) && !names.Add(name)) throw new InvalidDataException("La sauvegarde contient des chemins ambigus.");
            expanded += bytes.Length;
        }
        return SealArchive(key, zip =>
        {
            foreach (var (name, bytes) in files)
            {
                using var entry = zip.CreateEntry(name, CompressionLevel.Optimal).Open();
                entry.Write(bytes);
            }
        });
    }

    private static byte[] SealArchive(string key, Action<ZipArchive> write)
    {
        var header = Magic.Length + Salt + Nonce + Tag;
        using var plain = new MemoryStream();
        plain.SetLength(header);
        plain.Position = header;
        using (var zip = new ZipArchive(new OffsetWriteStream(plain, header), ZipArchiveMode.Create, leaveOpen: true)) write(zip);
        if (plain.Length > MaxSealedBytes)
            throw new InvalidDataException("La sauvegarde dépasse 256 Mo.");
        var totalLength = checked((int)plain.Length);
        var buffer = plain.GetBuffer().AsSpan(0, totalLength);
        Magic.CopyTo(buffer);
        var salt = buffer.Slice(Magic.Length, Salt);
        var nonce = buffer.Slice(Magic.Length + Salt, Nonce);
        var tag = buffer.Slice(Magic.Length + Salt + Nonce, Tag);
        var payload = buffer[header..];
        RandomNumberGenerator.Fill(salt);
        RandomNumberGenerator.Fill(nonce);
        using var aes = new AesGcm(Derive(key, salt), Tag);
        // Chiffrement sur place : aucun second tampon LOH de la taille de l'archive n'est alloué.
        aes.Encrypt(nonce, payload, payload, tag, Magic);
        return plain.GetBuffer().Length == totalLength ? plain.GetBuffer() : buffer.ToArray();
    }

    /// <summary>Le contenu d'une sauvegarde ; null si la clé n'est pas la bonne ou si le fichier n'en est pas une.</summary>
    public static Dictionary<string, byte[]>? Open(byte[] file, string key) => OpenEntries(file, key, null);

    /// <summary>Lit une entrée sans décompresser les extensions et autres fichiers de l'ancienne sauvegarde.</summary>
    public static Dictionary<string, byte[]>? OpenEntry(byte[] file, string key, string name) => OpenEntries(file, key, name);

    private static Dictionary<string, byte[]>? OpenEntries(byte[] file, string key, string? only)
    {
        var header = Magic.Length + Salt + Nonce + Tag;
        if (file.Length < header || file.Length > MaxSealedBytes || !file.AsSpan(0, Magic.Length).SequenceEqual(Magic)) return null;
        var data = new byte[file.Length - header];
        try
        {
            using var aes = new AesGcm(Derive(key, file.AsSpan(Magic.Length, Salt)), Tag);
            aes.Decrypt(file.AsSpan(Magic.Length + Salt, Nonce), file.AsSpan(header), file.AsSpan(Magic.Length + Salt + Nonce, Tag), data, Magic);
            if (!BoundedZipDirectory(data)) return null;
            var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
            using var zip = new ZipArchive(new MemoryStream(data), ZipArchiveMode.Read);
            if (zip.Entries.Count > MaxEntries) return null;
            long declared = 0;
            foreach (var entry in zip.Entries.Where(entry => Allowed(entry.FullName) && (only is null || entry.FullName == only)))
            {
                if (entry.Length < 0 || entry.Length > MaxEntryBytes || entry.Length > MaxExpandedBytes - declared) return null;
                declared += entry.Length;
            }
            long total = 0;
            var buffer = new byte[81920];
            foreach (var entry in zip.Entries)
            {
                if (!Allowed(entry.FullName) || only is not null && entry.FullName != only) continue;
                if (entry.Length < 0 || entry.Length > MaxEntryBytes || entry.Length > MaxExpandedBytes - total || files.ContainsKey(entry.FullName)) return null;
                using var content = new MemoryStream();
                using var stream = entry.Open();
                int count;
                while ((count = stream.Read(buffer)) != 0)
                {
                    total += count;
                    if (content.Length + count > MaxEntryBytes || total > MaxExpandedBytes) return null;
                    content.Write(buffer, 0, count);
                }
                if (content.Length != entry.Length) return null;
                files.Add(entry.FullName, content.ToArray());
            }
            return files;
        }
        catch (Exception e) when (e is CryptographicException or InvalidDataException) { return null; }
    }

    private static byte[] Derive(string key, ReadOnlySpan<byte> salt) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(key), salt, Iterations, HashAlgorithmName.SHA256, 32);
}
