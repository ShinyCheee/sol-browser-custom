using System.Collections.Concurrent;
using System.Text.Json;

namespace Browser.Core;

public static class JsonFileStore
{
    private static readonly JsonSerializerOptions Options = new() { RespectNullableAnnotations = true };
    private static readonly ConcurrentDictionary<string, object> Gates = new(
        OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);

    public static T Load<T>(string path, bool recoverBackup = true, bool requireReadable = false) where T : new()
    {
        JsonException? invalid = null;
        foreach (var candidate in recoverBackup ? new[] { path, path + ".bak" } : new[] { path })
        {
            if (!requireReadable && !File.Exists(candidate)) continue;
            try
            {
                using var stream = new FileStream(candidate, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                return JsonSerializer.Deserialize<T>(stream, Options) ?? throw new JsonException("Empty JSON document");
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
            catch (JsonException error)
            {
                invalid = error;
                if (requireReadable) continue; // preserve the originals for recovery, including an invalid backup
                try { File.Move(candidate, candidate + ".corrupt", overwrite: true); }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException) { System.Diagnostics.Trace.WriteLine(e); }
            }
            // Critical profile reads must not turn an inaccessible primary into defaults or a stale backup.
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                if (requireReadable) throw new IOException($"Could not read {Path.GetFileName(candidate)}. Existing data was preserved.", e);
                System.Diagnostics.Trace.WriteLine(e);
            }
        }
        if (requireReadable && (invalid is not null || File.Exists(path + ".corrupt") || File.Exists(path + ".bak.corrupt")))
            throw new InvalidDataException($"Could not recover {Path.GetFileName(path)}. Existing data was preserved.", invalid);
        return new T();
    }

    public static bool Save<T>(string path, T value)
    {
        string fullPath;
        try { fullPath = Path.GetFullPath(path); }
        catch (Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException)
        {
            System.Diagnostics.Trace.WriteLine(e);
            return false;
        }
        if (Directory.Exists(fullPath)) return false;

        var gate = Gates.GetOrAdd(fullPath, static _ => new object());
        lock (gate)
        {
            for (var attempt = 1; attempt <= 3; attempt++)
            {
                var tmp = $"{fullPath}.{Guid.NewGuid():N}.tmp";
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
                    using (var stream = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        JsonSerializer.Serialize(stream, value, Options);
                        stream.Flush(flushToDisk: true);
                    }
                    if (File.Exists(fullPath)) File.Replace(tmp, fullPath, fullPath + ".bak");
                    else File.Move(tmp, fullPath);
                    return true;
                }
                catch (IOException e) when (attempt < 3 && !Directory.Exists(fullPath))
                {
                    System.Diagnostics.Trace.WriteLine(e);
                    Thread.Sleep(15 * attempt);
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                {
                    System.Diagnostics.Trace.WriteLine(e);
                    return false; // garder le fichier précédent si le disque est plein ou le profil verrouillé
                }
                finally
                {
                    if (File.Exists(tmp))
                        try { File.Delete(tmp); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
                }
            }
            return false;
        }
    }
}
