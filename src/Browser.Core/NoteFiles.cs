using System.Text.Json.Serialization;

namespace Browser.Core;

public sealed record NoteFile(string Id, string Name, string Mime, byte[] Data);

/// <summary>
/// Pièces jointes des notes : métadonnées chargées paresseusement depuis « notes-assets.json » et octets rangés dans
/// « notes-assets/&lt;id&gt;.bin » (inclus dans les sauvegardes) ; mémoire seule en navigation privée.
/// </summary>
public sealed class NoteFiles(string? path)
{
    public const int MaxFile = 20 * 1024 * 1024, MaxTotal = 100 * 1024 * 1024;

    private sealed record AssetMeta(string Id, string Name, string Mime, int Size = 0,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] byte[]? Data = null);

    private List<AssetMeta>? _entries;
    private Dictionary<string, byte[]>? _memory;

    private List<AssetMeta> Entries { get { EnsureLoaded(); return _entries!; } }

    public IReadOnlyList<NoteFile> All => Entries.Select(e => Find(e.Id)).OfType<NoteFile>().ToList();

    public NoteFile? Find(string id)
    {
        var entry = Entries.Find(f => f.Id == id);
        if (entry is null) return null;
        if (_memory!.TryGetValue(id, out var cached)) return new NoteFile(entry.Id, entry.Name, entry.Mime, cached);
        if (path is null) return null;
        try
        {
            var bin = BinPath(id);
            if (!File.Exists(bin)) return null;
            using var stream = new FileStream(bin, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var copy = new MemoryStream();
            stream.CopyTo(copy);
            return new NoteFile(entry.Id, entry.Name, entry.Mime, copy.ToArray());
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    public NoteFile? Add(string name, byte[] data)
    {
        if (data.Length is 0 or > MaxFile || Entries.Sum(f => (long)f.Size) + data.Length > MaxTotal) return null;
        var file = Create(name, data);
        return file is not null && StoreNew([file]) ? file : null;
    }

    public Dictionary<string, string>? Import(Dictionary<string, (string Name, byte[] Data)> files)
    {
        if (files.Count > 1000 || files.Values.Any(f => f.Data.Length is 0 or > MaxFile)
            || Entries.Sum(f => (long)f.Size) + files.Values.Sum(f => (long)f.Data.Length) > MaxTotal) return null;
        var created = new List<NoteFile>(files.Count);
        var ids = new Dictionary<string, string>(files.Count);
        foreach (var (id, file) in files)
        {
            var item = Create(file.Name, file.Data);
            if (item is null) return null;
            created.Add(item);
            ids[id] = item.Id;
        }
        return StoreNew(created) ? ids : null;
    }

    public bool Keep(IReadOnlySet<string> ids)
    {
        if (Entries.All(f => ids.Contains(f.Id))) return true;
        var kept = Entries.Where(f => ids.Contains(f.Id)).ToList();
        var removed = Entries.Where(f => !ids.Contains(f.Id)).Select(f => f.Id).ToList();
        if (path is not null && !JsonFileStore.Save(path, kept)) return false;
        _entries = kept;
        foreach (var id in removed)
        {
            _memory!.Remove(id);
            if (path is not null) DeleteBin(id);
        }
        return true;
    }

    private bool StoreNew(IReadOnlyList<NoteFile> added)
    {
        EnsureLoaded();
        var next = _entries!.Concat(added.Select(f => new AssetMeta(f.Id, f.Name, f.Mime, f.Data.Length))).ToList();
        if (path is null)
        {
            foreach (var f in added) _memory![f.Id] = f.Data;
            _entries = next;
            return true;
        }
        if (Directory.Exists(Path.GetFullPath(path))) return false;
        var written = new List<string>(added.Count);
        try
        {
            foreach (var f in added) { WriteBin(f.Id, f.Data); written.Add(f.Id); }
            if (!JsonFileStore.Save(path, next))
            {
                foreach (var id in written) DeleteBin(id);
                return false;
            }
            _entries = next;
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException)
        {
            foreach (var id in written) DeleteBin(id);
            return false;
        }
    }

    private void EnsureLoaded()
    {
        if (_entries is not null) return;
        _memory = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        if (path is null) { _entries = []; return; }
        var loaded = JsonFileStore.Load<List<AssetMeta>>(path);
        var clean = new List<AssetMeta>(loaded.Count);
        var migrated = false;
        foreach (var item in loaded)
        {
            if (item is null || !ValidId(item.Id) || string.IsNullOrEmpty(item.Name) || string.IsNullOrEmpty(item.Mime)) continue;
            if (item.Data is { Length: > 0 and <= MaxFile } legacy)
            {
                try { WriteBin(item.Id, legacy); clean.Add(new AssetMeta(item.Id, item.Name, item.Mime, legacy.Length)); migrated = true; }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                { _memory[item.Id] = legacy; clean.Add(new AssetMeta(item.Id, item.Name, item.Mime, legacy.Length, legacy)); }
            }
            else
            {
                var bin = BinPath(item.Id);
                var size = item.Size > 0 ? item.Size : File.Exists(bin) ? (int)Math.Min(MaxFile, new FileInfo(bin).Length) : 0;
                if (size > 0) clean.Add(new AssetMeta(item.Id, item.Name, item.Mime, size));
            }
        }
        if (migrated) JsonFileStore.Save(path, clean);
        _entries = clean;
    }

    private string AssetsFolder => Path.Combine(Path.GetDirectoryName(Path.GetFullPath(path!))!, "notes-assets");
    private string BinPath(string id) => Path.Combine(AssetsFolder, id + ".bin");
    private static bool ValidId(string? id) => id is { Length: 32 } && id.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    private void WriteBin(string id, byte[] data)
    {
        Directory.CreateDirectory(AssetsFolder);
        var target = BinPath(id);
        var tmp = $"{target}.{Guid.NewGuid():N}.tmp";
        try
        {
            using (var stream = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(data);
                stream.Flush(flushToDisk: true);
            }
            File.Move(tmp, target, overwrite: true);
        }
        finally { if (File.Exists(tmp)) try { File.Delete(tmp); } catch (IOException) { } }
    }

    private void DeleteBin(string id)
    {
        try { File.Delete(BinPath(id)); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    private static NoteFile? Create(string name, byte[] data)
    {
        name = Path.GetFileName(name);
        name = new string(name.Where(c => !Path.GetInvalidFileNameChars().Contains(c)).ToArray());
        if (name.Length is 0 or > 180) return null;
        var mime = data.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) ? "image/png"
            : data.AsSpan().StartsWith(new byte[] { 255, 216, 255 }) ? "image/jpeg"
            : data.AsSpan().StartsWith("GIF8"u8) ? "image/gif"
            : data.Length >= 12 && data.AsSpan(0, 4).SequenceEqual("RIFF"u8) && data.AsSpan(8, 4).SequenceEqual("WEBP"u8) ? "image/webp"
            : data.AsSpan().StartsWith("%PDF-"u8) ? "application/pdf"
            : data.AsSpan().StartsWith("ID3"u8) || name.EndsWith(".mp3", StringComparison.OrdinalIgnoreCase) ? "audio/mpeg"
            : name.EndsWith(".wav", StringComparison.OrdinalIgnoreCase) ? "audio/wav"
            : name.EndsWith(".webm", StringComparison.OrdinalIgnoreCase) ? "audio/webm" : "application/octet-stream";
        return new NoteFile(Guid.NewGuid().ToString("N"), name, mime, data);
    }
}
