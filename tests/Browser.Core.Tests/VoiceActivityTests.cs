using Browser.Core;

namespace Browser.Core.Tests;

public class VoiceActivityTests
{
    [Fact]
    public void SilenceTimesOutWithoutProducingAnUtterance()
    {
        var activity = new VoiceActivity();
        for (var n = 0; n < 1500; n++) activity.Push(new short[320], 0);
        Assert.Equal("timeout", activity.State);
        Assert.False(activity.HasSpeech);
    }
    [Fact]
    public void PreservesPreRollAndFinishesAfterOneSecondWithoutSpeechEvenWithBackgroundNoise()
    {
        var activity = new VoiceActivity();
        for (var n = 0; n < 30; n++) activity.Push(new short[320], 0);
        var speech = Enumerable.Range(0, 320).Select(i => (short)(Math.Sin(i * .3) * 6000)).ToArray();
        for (var n = 0; n < 20; n++) activity.Push(speech, .9);
        var noise = Enumerable.Repeat((short)2000, 320).ToArray();
        for (var n = 0; n < 49; n++) activity.Push(noise, .1);
        Assert.Equal("listening", activity.State);
        activity.Push(noise, .1);
        Assert.Equal("complete", activity.State);
        Assert.True(activity.HasSpeech);
        Assert.InRange(activity.Audio.Length, 16000, 32000);
        var length = activity.Audio.Length;
        activity.Push(speech, .9);
        Assert.Equal(length, activity.Audio.Length);
    }
    [Fact]
    public void TinyClickIsNotSpeechAndLongCaptureIsBounded()
    {
        var click = new VoiceActivity();
        click.Push(Enumerable.Repeat((short)10000, 320).ToArray(), .9);
        for (var n = 0; n < 70; n++) click.Push(new short[320], 0);
        Assert.False(click.HasSpeech);
        var longAudio = new VoiceActivity();
        for (var n = 0; n < 6001; n++) longAudio.Push(Enumerable.Repeat((short)6000, 320).ToArray(), .9);
        Assert.Equal("complete", longAudio.State);
        Assert.True(longAudio.Audio.Length <= 30 * 16000);
    }
    [Fact]
    public void LowGainSpeechIsAcceptedButStationaryLoudNoiseNeverCreatesARequest()
    {
        var quiet = new VoiceActivity();
        for (var n = 0; n < 20; n++) quiet.Push(Enumerable.Repeat((short)100, 320).ToArray(), .9);
        for (var n = 0; n < 50; n++) quiet.Push(new short[320], 0);
        Assert.True(quiet.HasSpeech);
        Assert.Equal("complete", quiet.State);
        var noise = new VoiceActivity();
        for (var n = 0; n < 1000; n++) noise.Push(Enumerable.Repeat((short)8000, 320).ToArray(), .1);
        Assert.False(noise.HasSpeech);
        Assert.Equal("timeout", noise.State);
        Assert.Empty(noise.Audio);
    }
}
