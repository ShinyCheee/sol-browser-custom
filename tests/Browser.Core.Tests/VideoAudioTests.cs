using Browser.Core;

namespace Browser.Core.Tests;

public class VideoAudioTests
{
    [Theory]
    [InlineData("video", false)]
    [InlineData("flac", true)]
    [InlineData("wav", true)]
    [InlineData("mp3", true)]
    [InlineData(null, false)]
    public void OutputAllowlistPreservesVideoDefault(string? output, bool audio)
    {
        Assert.True(VideoAudioFormat.IsValid(output));
        Assert.Equal(audio, VideoAudioFormat.IsAudio(output));
    }

    [Theory]
    [InlineData("video.download")]
    [InlineData("video.batch")]
    public void CommandsCarryOutputAndRejectUntrustedEncoderArguments(string type)
    {
        var head = $$"""{"type":"{{type}}","id":"tab","query":"cached","input":"[]","index":720""";
        Assert.Null(CommandParser.Parse(head + ",\"output\":\"mp3 --exec bad\"}"));
        Assert.Null(CommandParser.Parse(head + ",\"output\":12}"));
        Assert.Null(CommandParser.Parse(head + ",\"output\":null}"));
        foreach (var format in new[] { "video", "flac", "wav", "mp3" })
            Assert.Equal(format, CommandParser.Parse(head + ",\"output\":\"" + format + "\"}")!.Output);
        Assert.Null(CommandParser.Parse(head + "}")!.Output);
    }

    [Fact]
    public void EncodersAvoidResamplingAndUseMaximumMp3Bitrate()
    {
        Assert.Contains("320k", VideoAudioFormat.EncoderArguments("mp3"));
        Assert.Contains("pcm_f32le", VideoAudioFormat.EncoderArguments("wav"));
        Assert.Contains("flac", VideoAudioFormat.EncoderArguments("flac"));
        foreach (var format in new[] { "wav", "flac", "mp3" })
        {
            Assert.DoesNotContain("-ar", VideoAudioFormat.EncoderArguments(format));
            Assert.DoesNotContain("-ac", VideoAudioFormat.EncoderArguments(format));
        }
        Assert.Throws<ArgumentException>(() => VideoAudioFormat.EncoderArguments("aac"));
    }
}
