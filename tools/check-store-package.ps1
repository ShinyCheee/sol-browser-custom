param([Parameter(Mandatory)][string]$Package)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $Package).Path)
try {
    $names = @($archive.Entries.FullName)
    if ('resources.pri' -notin $names) {
        throw 'MSIX WinUI invalide : resources.pri manque a la racine du paquet.'
    }
    if ('Sol.pri' -in $names) { throw 'Le PRI non empaquete Sol.pri ne doit pas remplacer resources.pri.' }
    foreach ($size in 16,20,24,30,32,36,40,48,60,64,72,80,96,256) {
        foreach ($form in '', '_altform-unplated', '_altform-lightunplated') {
            $asset = "StoreAssets/Square44x44Logo.targetsize-$size$form.png"
            if ($asset -notin $names) { throw "Icone Windows sans plaque absente : $asset" }
        }
    }
    foreach ($required in 'Sol.exe', 'Microsoft.UI.Xaml.dll', 'AppxManifest.xml', 'Assets/SolFile.ico', 'StoreAssets/FileLogo.png') {
        if ($required -notin $names) { throw "Fichier requis absent : $required" }
    }
    $reader = [IO.StreamReader]::new($archive.GetEntry('AppxManifest.xml').Open())
    try { $manifest = [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
    $logo = $manifest.SelectSingleNode("//*[local-name()='FileTypeAssociation' and @Name='solweb']/*[local-name()='Logo']")
    if ($logo.InnerText -ne 'StoreAssets\FileLogo.png') { throw 'Logo de fichiers absent du manifeste.' }
    foreach ($asset in @{ 'Square44x44Logo.targetsize-32_altform-unplated.png' = 0; 'FileLogo.png' = 255 }.GetEnumerator()) {
        $stream = [IO.MemoryStream]::new()
        $entry = $archive.GetEntry("StoreAssets/$($asset.Key)").Open()
        try {
            $entry.CopyTo($stream)
            $stream.Position = 0
            $image = [Drawing.Bitmap]::new($stream)
            try {
                if ($image.GetPixel([int]($image.Width / 2), 0).A -ne $asset.Value) {
                    throw "Fond incorrect pour $($asset.Key)."
                }
            } finally { $image.Dispose() }
        } finally { $entry.Dispose(); $stream.Dispose() }
    }
    [pscustomobject]@{
        Package = (Resolve-Path $Package).Path
        Version = $manifest.Package.Identity.Version
        Architecture = $manifest.Package.Identity.ProcessorArchitecture
        Resources = 'resources.pri'
        SHA256 = (Get-FileHash $Package -Algorithm SHA256).Hash
    }
}
finally { $archive.Dispose() }
