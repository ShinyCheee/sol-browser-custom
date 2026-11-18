namespace Browser.Core;

/// <summary>
/// Marque un fichier téléchargé comme provenant d'Internet (ZoneId=3) via le flux alternatif NTFS « Zone.Identifier »,
/// afin que SmartScreen et les applications locales appliquent leurs garde-fous d'ouverture.
/// </summary>
public static class MarkOfTheWeb
{
    private const string ZoneTransfer = "[ZoneTransfer]\r\nZoneId=3\r\n";

    public static void Apply(string path)
    {
        if (!OperatingSystem.IsWindows() || string.IsNullOrWhiteSpace(path)) return;
        try
        {
            File.WriteAllText(path + ":Zone.Identifier", ZoneTransfer);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or NotSupportedException or ArgumentException)
        {
            // Systèmes de fichiers sans flux alternatifs (FAT32, exFAT, partages réseau) ou chemins spéciaux.
        }
    }
}
