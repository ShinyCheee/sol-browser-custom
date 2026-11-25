# Holt die neueste Version aus dem Fork, baut sie und installiert sie als "Sol Custom".
#   powershell -ExecutionPolicy Bypass -File tools\update-local.ps1          normales Update
#   powershell -ExecutionPolicy Bypass -File tools\update-local.ps1 -Test    nur testen, mit separatem Testprofil
#
# Einstellungen, Tabs, Verlauf usw. liegen in %LOCALAPPDATA%\Sol und werden NICHT angefasst.
# Das Programm selbst landet in %LOCALAPPDATA%\SolCustom\app und wird bei jedem Update ersetzt.
# Vor jedem Update wird eine Sicherung des Datenordners angelegt (die letzten 5 bleiben erhalten).
param([switch]$Test)
$ErrorActionPreference = 'Stop'

$root    = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$data    = Join-Path $env:LOCALAPPDATA 'Sol'
$install = Join-Path $env:LOCALAPPDATA 'SolCustom'
$app     = Join-Path $install 'app'
$project = Join-Path $root 'src\Browser.App\Browser.App.csproj'

foreach ($tool in 'git', 'npm', 'dotnet') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool fehlt. Benötigt: Git, Node.js LTS und .NET 10 SDK." }
}

Write-Host '==> Neueste Version holen' -ForegroundColor Cyan
git -C $root pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'git pull fehlgeschlagen (lokale Änderungen?)' }

Write-Host '==> Oberfläche bauen' -ForegroundColor Cyan
Push-Location (Join-Path $root 'ui')
try {
    npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci fehlgeschlagen' }
    npm run build;               if ($LASTEXITCODE -ne 0) { throw 'Oberfläche: Build fehlgeschlagen' }
} finally { Pop-Location }

if ($Test) {
    # Testlauf mit eigenem Profilordner: echte Daten bleiben unberührt.
    $testData = Join-Path $env:LOCALAPPDATA 'SolCustom\test-data'
    Write-Host "==> Testlauf (Daten in $testData)" -ForegroundColor Cyan
    $env:NAVIGATEUR_DATA_DIR = $testData
    dotnet run --project $project
    return
}

Write-Host '==> Tests' -ForegroundColor Cyan
dotnet test (Join-Path $root 'tests\Browser.Core.Tests') -c Release --nologo -v m -tl:off
if ($LASTEXITCODE -ne 0) { throw 'Tests fehlgeschlagen, nichts installiert' }

if (Get-Process -Name 'Sol' -ErrorAction SilentlyContinue) {
    Read-Host 'Sol läuft noch. Bitte schließen und Enter drücken'
    if (Get-Process -Name 'Sol' -ErrorAction SilentlyContinue) { throw 'Sol läuft noch, Abbruch' }
}

if (Test-Path $data) {
    Write-Host '==> Datenordner sichern' -ForegroundColor Cyan
    $backups = Join-Path $install 'backups'
    New-Item -ItemType Directory -Force $backups | Out-Null
    $target = Join-Path $backups (Get-Date -Format 'yyyy-MM-dd_HH-mm')
    # Ohne WebView2-Cache (groß und neu erzeugbar)
    robocopy $data $target /E /XD webview2 Cache "Code Cache" GPUCache /NFL /NDL /NJH /NJS /NP | Out-Null
    Get-ChildItem $backups -Directory | Sort-Object Name -Descending | Select-Object -Skip 5 | Remove-Item -Recurse -Force
}

Write-Host '==> Bauen und installieren' -ForegroundColor Cyan
$staging = Join-Path $install 'app-new'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
dotnet publish $project -c Release -r win-x64 -p:Platform=x64 --self-contained true -o $staging --nologo -v m -tl:off
if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen, alte Version bleibt' }
foreach ($notice in 'LICENSE', 'THIRD-PARTY-NOTICES.md') {
    $file = Join-Path $root $notice
    if (Test-Path $file) { Copy-Item $file $staging }
}
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
Move-Item $staging $app

$exe = Join-Path $app 'Sol.exe'
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
    $link = $shell.CreateShortcut((Join-Path $dir 'Sol Custom.lnk'))
    $link.TargetPath = $exe
    $link.WorkingDirectory = $app
    $link.Save()
}

$commit = git -C $root log -1 --format='%h %s'
Write-Host "Fertig: $commit" -ForegroundColor Green
Start-Process $exe
