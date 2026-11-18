using System.IO.Compression;
using System.Text.Json;

namespace Browser.Core;

public static partial class Backup
{
    // These are installation staging/rollback copies and engine-generated indexes, never extension source data.
    private static bool TransientBackupPath(string name)
    {
        var parts = name.Split('/');
        if (parts.Length < 2 || parts[0] != "extensions") return false;
        var folder = parts[1];
        var previous = folder.IndexOf("-previous-", StringComparison.Ordinal);
        return folder == "ajout"
            || folder.StartsWith("store-", StringComparison.Ordinal) && Guid.TryParseExact(folder[6..], "N", out _)
            || previous == 32 && ExtensionCatalog.IsId(folder[..32]) && Guid.TryParseExact(folder[(previous + 10)..], "N", out _)
            || parts.Length >= 4 && parts[2] == "_metadata" && parts[3] == "generated_indexed_rulesets";
    }

    private static (Dictionary<string, string> Paths, byte[] Manifest) ProfileContent(string dataDir)
    {
        var paths = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var directories = new List<string>();
        var options = new EnumerationOptions { RecurseSubdirectories = true, AttributesToSkip = FileAttributes.ReparsePoint, IgnoreInaccessible = false };
        foreach (var name in ProfileFiles)
            if (name != "browser.db" && File.Exists(Path.Combine(dataDir, name))) paths.Add(name, Path.Combine(dataDir, name));
        foreach (var folder in ProfileFolders)
        {
            var root = Path.Combine(dataDir, folder);
            if (!Directory.Exists(root)) continue;
            if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) throw new InvalidDataException("Dossier de sauvegarde redirigé.");
            string Relative(string path) => folder + "/" + Path.GetRelativePath(root, path).Replace('\\', '/');
            directories.AddRange(Directory.EnumerateDirectories(root, "*", options).Select(Relative).Where(name => !TransientBackupPath(name)));
            foreach (var file in Directory.EnumerateFiles(root, "*", options))
            {
                var name = Relative(file);
                if (!TransientBackupPath(name)) paths.Add(name, file);
            }
        }
        var manifest = JsonSerializer.SerializeToUtf8Bytes(new ProfileManifest(1, ProfileFiles, ProfileFolders, directories.ToArray()));
        return (paths, manifest);
    }

    /// <summary>Compresses files directly from disk instead of retaining every uncompressed extension in memory.</summary>
    public static byte[] SealProfile(string dataDir, IReadOnlyDictionary<string, byte[]> overrides, string key)
    {
        var (paths, manifest) = ProfileContent(dataDir);
        var extra = new Dictionary<string, byte[]>(overrides, StringComparer.OrdinalIgnoreCase) { [Manifest] = manifest };
        foreach (var name in extra.Keys)
        {
            if (!Allowed(name)) throw new InvalidDataException("Chemin de sauvegarde refusé.");
            paths.Remove(name);
        }
        if (paths.Count + extra.Count > MaxEntries) throw new InvalidDataException("La sauvegarde contient trop de fichiers.");
        long total = 0;
        void Count(long length)
        {
            if (length > MaxEntryBytes || length > MaxExpandedBytes - total)
                throw new InvalidDataException("Le contenu de la sauvegarde dépasse la taille restaurable.");
            total += length;
        }
        foreach (var bytes in extra.Values) Count(bytes.LongLength);
        // Preflight all sizes before opening any large source file.
        foreach (var path in paths.Values) Count(new FileInfo(path).Length);
        return SealArchive(key, zip =>
        {
            foreach (var (name, bytes) in extra)
            {
                using var entry = zip.CreateEntry(name, CompressionLevel.Optimal).Open();
                entry.Write(bytes);
            }
            var buffer = new byte[81920];
            var written = extra.Values.Sum(bytes => (long)bytes.Length);
            foreach (var (name, path) in paths)
            {
                using var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var entry = zip.CreateEntry(name, CompressionLevel.Optimal).Open();
                long size = 0;
                int count;
                while ((count = source.Read(buffer)) > 0)
                {
                    size += count; written += count;
                    if (size > MaxEntryBytes || written > MaxExpandedBytes) throw new InvalidDataException("Le contenu de la sauvegarde dépasse la taille restaurable.");
                    entry.Write(buffer, 0, count);
                }
            }
        });
    }
}
