param([string]$Destination = (Join-Path $PSScriptRoot '../bin/voice-runtime'))
$ErrorActionPreference = 'Stop'
# Ohne Fortschrittsbalken ist Invoke-WebRequest unter Windows PowerShell 5 um ein Vielfaches schneller.
$ProgressPreference = 'SilentlyContinue'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destinationPath = [IO.Path]::GetFullPath($Destination)
$cache = Join-Path (Split-Path $root -Qualifier) 'dev/voice-wheels'
$lockFile = Join-Path $PSScriptRoot 'voice-worker/runtime-lock.json'
$fingerprint = (Get-FileHash -LiteralPath $lockFile).Hash
$stamp = Join-Path $destinationPath 'runtime.ready'
if ((Test-Path -LiteralPath $stamp) -and (Get-Content -LiteralPath $stamp -Raw).Trim() -eq $fingerprint) { return }
New-Item -ItemType Directory -Force $cache,$destinationPath | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
function FetchVerified($url, $name, $hash) {
    $path = Join-Path $cache $name
    if ((Test-Path -LiteralPath $path) -and (Get-FileHash -LiteralPath $path).Hash -ne $hash) { Remove-Item -LiteralPath $path }
    if (-not (Test-Path -LiteralPath $path)) {
        Write-Output "Sprach-Runtime: lade $name ..."
        Invoke-WebRequest -UseBasicParsing $url -OutFile ($path + '.part')
        if ((Get-FileHash -LiteralPath ($path + '.part')).Hash -ne $hash) { throw "Invalid voice runtime digest: $name" }
        Move-Item -LiteralPath ($path + '.part') -Destination $path -Force
    }
    return $path
}
function Unzip($path, $target) {
    $archive = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            $output = [IO.Path]::GetFullPath((Join-Path $target $entry.FullName))
            if (-not $output.StartsWith($target.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid runtime archive path' }
            New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($output)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $output, $true)
        }
    } finally { $archive.Dispose() }
}
$lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
$python = FetchVerified $lock.python.url 'python-3.13.9-embed-amd64.zip' $lock.python.sha256
Unzip $python $destinationPath
$packages = Join-Path $destinationPath 'packages'
New-Item -ItemType Directory -Force $packages | Out-Null
foreach ($wheel in $lock.wheels) { Unzip (FetchVerified $wheel.url $wheel.filename $wheel.sha256) $packages }
# Isolated search paths: no user site, registry, PYTHONPATH or system Python required.
[IO.File]::WriteAllText((Join-Path $destinationPath 'python313._pth'), "python313.zip`n.`npackages`n..`nimport site`n")
$sources = Join-Path $destinationPath 'licenses/sources'
New-Item -ItemType Directory -Force $sources | Out-Null
foreach ($source in $lock.sources) { Copy-Item -LiteralPath (FetchVerified $source.url $source.name $source.sha256) -Destination $sources -Force }
foreach ($asset in $lock.assets) { Copy-Item -LiteralPath (FetchVerified $asset.url $asset.name $asset.sha256) -Destination $destinationPath -Force }
Copy-Item -LiteralPath $lockFile -Destination (Join-Path $destinationPath 'licenses/runtime-lock.json') -Force
[IO.File]::WriteAllText($stamp, $fingerprint)
Write-Output 'Verified embedded voice runtime ready (Windows x64)'
