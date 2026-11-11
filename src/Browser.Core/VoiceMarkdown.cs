namespace Browser.Core;

// Same-length mask lets streaming segmentation retain original offsets and incomplete delimiters.
public static class VoiceMarkdown
{
    public static string MaskCode(string text, out int incomplete)
    {
        var output = text.ToCharArray();
        char fence = '\0';
        var fenceLength = 0;
        var inlineLength = 0;
        var openedAt = -1;
        var lineStart = 0;
        for (var i = 0; i < text.Length;)
        {
            var ch = text[i];
            var run = 1;
            if (ch is '`' or '~') while (i + run < text.Length && text[i + run] == ch) run++;
            var prefix = text.AsSpan(lineStart, i - lineStart);
            var atStart = prefix.Length <= 3 && prefix.Trim().Length == 0;
            if (fence != '\0')
            {
                if (ch == fence && run >= fenceLength && atStart)
                {
                    for (var k = 0; k < run; k++) output[i + k] = ' ';
                    fence = '\0'; openedAt = -1; i += run; continue;
                }
                output[i] = ' '; if (ch == '\n') lineStart = i + 1;
                i++; continue;
            }
            if (inlineLength > 0)
            {
                if (ch == '`' && run == inlineLength)
                {
                    for (var k = 0; k < run; k++) output[i + k] = ' ';
                    inlineLength = 0; openedAt = -1; i += run; continue;
                }
                output[i] = ' '; if (ch == '\n') lineStart = i + 1;
                i++; continue;
            }
            if (ch is '`' or '~' && run >= 3 && atStart)
            {
                fence = ch; fenceLength = run; openedAt = i;
                for (var k = 0; k < run; k++) output[i + k] = ' ';
                i += run; continue;
            }
            if (ch == '`')
            {
                inlineLength = run; openedAt = i;
                for (var k = 0; k < run; k++) output[i + k] = ' ';
                i += run; continue;
            }
            if (ch == '\n') lineStart = i + 1;
            i++;
        }
        incomplete = openedAt;
        return new string(output);
    }
}
