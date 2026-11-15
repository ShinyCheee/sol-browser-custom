using Browser.Core;

public sealed class BackupCollectionTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("sol-backup-collection-").FullName;
    private const string Id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    private void Write(string name, string content = "content")
    {
        var path = Path.Combine(_root, name.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    [Fact]
    public void Backup_excludes_installation_copies_and_compiled_rules_but_keeps_extension_sources()
    {
        Write($"extensions/{Id}/manifest.json", "manifest");
        Write($"extensions/{Id}/rules/source.json", "rules");
        Write($"extensions/{Id}/_metadata/generated_indexed_rulesets/_ruleset1", "generated");
        Write($"extensions/{Id}-previous-0123456789abcdef0123456789abcdef/manifest.json");
        Write("extensions/store-0123456789abcdef0123456789abcdef/manifest.json");
        Write("session-permissions/work.json", "permissions");

        var files = Backup.Collect(_root);
        Assert.Equal(new[] { $"extensions/{Id}/manifest.json", $"extensions/{Id}/rules/source.json",
            "profile-manifest.json", "session-permissions/work.json" }.Order(), files.Keys.Order());
        Assert.True(File.Exists(Path.Combine(_root, "extensions", $"{Id}-previous-0123456789abcdef0123456789abcdef", "manifest.json")));
    }

    [Fact]
    public void Streaming_profile_backup_keeps_empty_folders_and_uses_current_files_and_database_snapshot()
    {
        Write("settings.json", "current settings");
        Write("browser.db", "live database must not be copied");
        Write($"extensions/{Id}/manifest.json", "extension");
        Directory.CreateDirectory(Path.Combine(_root, "session-permissions", "empty"));
        var sealedFile = Backup.SealProfile(_root, new Dictionary<string, byte[]>
        {
            ["browser.db"] = "consistent database"u8.ToArray(),
            [Backup.Passwords] = "{\"Version\":1,\"Profiles\":[],\"Unreadable\":0}"u8.ToArray(),
        }, "a long backup key");
        var files = Backup.Open(sealedFile, "a long backup key")!;
        Assert.Equal("consistent database"u8.ToArray(), files["browser.db"]);
        Assert.Equal("current settings"u8.ToArray(), files["settings.json"]);
        Assert.Equal("extension"u8.ToArray(), files[$"extensions/{Id}/manifest.json"]);
        Assert.Equal("{\"Version\":1,\"Profiles\":[],\"Unreadable\":0}"u8.ToArray(), files[Backup.Passwords]);
        // This test targets streamed files and empty folders; native password staging has its own Windows checks.
        files.Remove(Backup.Passwords);
        var target = Path.Combine(_root, "restored");
        Backup.Stage(target, files);
        Assert.True(Backup.ApplyStaged(target));
        Assert.True(Directory.Exists(Path.Combine(target, "session-permissions", "empty")));
    }

    public void Dispose() => Directory.Delete(_root, true);
}
