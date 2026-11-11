using System.Text;

namespace Browser.Core;

// Only displayable assistant text enters this buffer; tool/reasoning payloads never do.
public sealed class VoiceSpeechBuffer
{
    private readonly StringBuilder _pending = new();
    private int _spoken;
    public IReadOnlyList<string> Append(string delta)
    {
        if (_spoken >= 4000) return [];
        if (_pending.Length + delta.Length > 80_000) return [];
        _pending.Append(delta);
        return Drain(false);
    }
    public IReadOnlyList<string> Finish() => Drain(true);
    private IReadOnlyList<string> Drain(bool final)
    {
        var raw = _pending.ToString();
        var text = VoiceMarkdown.MaskCode(raw, out var incomplete);
        var limit = incomplete < 0 ? text.Length : incomplete;
        var output = new List<string>();
        var brackets = 0;
        var parentheses = 0;
        var start = 0;
        for (var i = 0; i < limit; i++)
        {
            var ch = text[i];
            if (ch == '[') brackets++;
            if (ch == ']') brackets = Math.Max(0, brackets - 1);
            if (ch == '(') parentheses++;
            if (ch == ')') parentheses = Math.Max(0, parentheses - 1);
            if (brackets != 0 || parentheses != 0 || ch is not ('.' or '!' or '?' or '\n')) continue;
            if (i + 1 == text.Length && !final || i + 1 < text.Length && !char.IsWhiteSpace(text[i + 1])) continue;
            var tokenAt = text.LastIndexOf(' ', i, i - start + 1);
            var token = text[(Math.Max(start, tokenAt + 1))..(i + 1)];
            if (token.StartsWith("http", StringComparison.OrdinalIgnoreCase)) continue;
            Emit(text[start..(i + 1)], output);
            start = i + 1;
        }
        if (final)
        {
            var tail = text[start..limit];
            // An unfinished fence/link is never spoken, including at a network failure.
            if (brackets == 0 && parentheses == 0) Emit(tail, output);
            start = text.Length;
        }
        if (start > 0) _pending.Remove(0, start);
        return output;
    }
    private void Emit(string raw, List<string> output)
    {
        var cleaned = SolVoiceText.ForSpeech(raw);
        if (cleaned.Length == 0 || _spoken >= 4000) return;
        cleaned = cleaned[..Math.Min(cleaned.Length, 4000 - _spoken)];
        _spoken += cleaned.Length;
        output.Add(cleaned);
    }
}
