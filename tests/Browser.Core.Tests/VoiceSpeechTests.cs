using Browser.Core;

namespace Browser.Core.Tests;

public class VoiceSpeechTests
{
    [Theory]
    [InlineData("~~~python\nprint('secret. ')\n~~~\nTexte normal. ")]
    [InlineData("````python\nsecret. ```\n````\nTexte normal. ")]
    [InlineData("```python\n```not_closing\nsecret.\n```   \nTexte normal. ")]
    [InlineData("`secret. `Texte normal. ")]
    public void ExcludesAllCodeDelimitersIncludingFragmentedOnes(string input)
    {
        var buffer = new VoiceSpeechBuffer();
        var spoken = new List<string>();
        foreach (var ch in input) spoken.AddRange(buffer.Append(ch.ToString()));
        spoken.AddRange(buffer.Finish());
        Assert.Equal("Texte normal.", string.Join(" ", spoken));
        Assert.DoesNotContain("secret", SolVoiceText.ForSpeech(input));
    }
    [Fact]
    public void StreamsCompletePhrasesOnceAndWaitsForFragmentedMarkdown()
    {
        var buffer = new VoiceSpeechBuffer();
        Assert.Empty(buffer.Append("Bonjour"));
        Assert.Equal(["Bonjour."], buffer.Append(". "));
        Assert.Empty(buffer.Append("[Le guide](https://example.org/a."));
        Assert.Equal(["Le guide est prêt."], buffer.Append("pdf) est **prêt**. "));
        Assert.Empty(buffer.Append("```cs\nsecret. "));
        Assert.Empty(buffer.Append("hidden\n```\n"));
        Assert.Equal(["Au revoir"], buffer.Append("Au revoir").Concat(buffer.Finish()));
        Assert.Empty(buffer.Finish());
    }
    [Fact]
    public void DoesNotReadUnclosedCodeOrRawUrlsAndBoundsSpeech()
    {
        var buffer = new VoiceSpeechBuffer();
        Assert.Equal(["Voir Oui."], buffer.Append("Voir https://example.org. Oui. "));
        Assert.Empty(buffer.Append("``` secret"));
        Assert.Empty(buffer.Finish());
        var longText = new VoiceSpeechBuffer();
        Assert.True(longText.Append(new string('x', 50000)).Concat(longText.Finish()).Sum(p => p.Length) <= 4000);
    }
    [Fact]
    public void StoppingAndRestartingInvalidatesOldTurns()
    {
        var turn = new VoiceTurn();
        var first = turn.Begin(true, true);
        Assert.True(turn.Accepts(first));
        turn.Stop();
        Assert.False(turn.Complete(first, true));
        var second = turn.Begin(false, false);
        Assert.False(turn.Accepts(first));
        Assert.False(turn.Complete(second, true));
        var third = turn.Begin(true, true);
        Assert.True(turn.Complete(third, true));
        Assert.False(turn.Complete(third, false));
    }
}
