using Browser.Core;

public sealed class FileDownloadTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("sol-filedownload-").FullName;
    public void Dispose() => Directory.Delete(_dir, recursive: true);

    [Fact]
    public async Task Start_pause_resume_completes_deduplicates_name_and_marks_zone_identifier()
    {
        var data = SegmentedTransferTests.NonZeroData(8 << 20, seed: 11);
        await using var server = new RangeServer(data);
        var desired = Path.Combine(_dir, "archive.bin");
        await File.WriteAllBytesAsync(desired, [1, 2, 3]); // occupe déjà le nom initial

        var download = new FileDownload(server.Url, desired, "https://site.example/page", "SolTest/1.0", []);
        server.ArmPause(2 << 20, download.Pause);
        download.Start();

        await WaitUntilAsync(() => download.State == "Interrupted");
        await server.SettleAsync();
        Assert.True(download.Paused);
        Assert.False(download.Canceled);
        Assert.True(download.CanResume);
        Assert.Equal("paused", download.Phase);

        download.Resume();
        await WaitUntilAsync(() => download.State != "InProgress" && !download.Paused);
        Assert.Equal("Completed", download.State);
        Assert.Equal("done", download.Phase);
        Assert.Equal(Path.Combine(_dir, "archive (2).bin"), download.ResultFilePath);
        Assert.Equal(data, await File.ReadAllBytesAsync(download.ResultFilePath));
        Assert.False(File.Exists(desired + ".part"));
        Assert.False(File.Exists(SegmentedTransfer.PlanPath(desired + ".part")));

        if (OperatingSystem.IsWindows())
        {
            var zone = await File.ReadAllTextAsync(download.ResultFilePath + ":Zone.Identifier");
            Assert.Contains("ZoneId=3", zone);
        }
    }

    [Fact]
    public async Task Cancel_deletes_partial_files_and_network_failure_without_plan_is_not_resumable()
    {
        var data = SegmentedTransferTests.Data(8 << 20, seed: 22);
        await using var server = new RangeServer(data);
        var target = Path.Combine(_dir, "canceled.bin");
        var job = new FileDownload(server.Url, target, null, "", []);
        server.ArmPause(2 << 20, job.Cancel);
        job.Start();

        await WaitUntilAsync(() => job.State == "Interrupted" && !File.Exists(target + ".part"));
        await server.SettleAsync();
        Assert.True(job.Canceled);
        Assert.False(job.CanResume);
        Assert.False(File.Exists(target));
        Assert.False(File.Exists(SegmentedTransfer.PlanPath(target + ".part")));

        server.StatusCode = 500;
        var failed = new FileDownload(server.Url, Path.Combine(_dir, "failed.bin"), null, "", []);
        failed.Start();
        await WaitUntilAsync(() => failed.State == "Interrupted");
        Assert.Equal("failed", failed.Phase);
        Assert.False(failed.Paused);
        Assert.False(failed.CanResume);

        // Chemin inexistant ou invalide : MarkOfTheWeb ne lève jamais.
        MarkOfTheWeb.Apply(Path.Combine(_dir, "missing", "none.bin"));
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!condition()) await Task.Delay(15, timeout.Token);
    }
}
