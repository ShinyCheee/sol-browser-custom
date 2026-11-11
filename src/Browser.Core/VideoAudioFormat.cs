namespace Browser.Core;

// The format is an allowlist, never an arbitrary encoder name or command argument.
public static class VideoAudioFormat
{
    public static bool IsValid(string? format) => format is null or "video" or "flac" or "wav" or "mp3";
    public static bool IsAudio(string? format) => format is "flac" or "wav" or "mp3";
    public const string Selector = "ba/b";
    public static string[] EncoderArguments(string format) => format switch
    {
        "flac" => ["-c:a", "flac", "-sample_fmt", "s32", "-compression_level", "8"],
        "wav" => ["-c:a", "pcm_f32le"],
        "mp3" => ["-c:a", "libmp3lame", "-b:a", "320k"],
        _ => throw new ArgumentException("Unsupported audio format", nameof(format)),
    };
    public static bool IsMediaOutput(string path) => new[] { ".mp4", ".webm", ".mov", ".mkv", ".m4v", ".ogv",
        ".m4a", ".opus", ".ogg", ".flac", ".wav", ".mp3", ".aac" }.Contains(Path.GetExtension(path).ToLowerInvariant());
}
