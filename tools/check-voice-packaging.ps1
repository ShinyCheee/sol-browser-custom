$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$report = Join-Path $root 'bin/voice-evidence/package-items.json'
& dotnet msbuild (Join-Path $root 'src/Browser.App/Browser.App.csproj') -nologo -verbosity:quiet -target:PrepareSolVoice -property:Platform=x64 -property:RuntimeIdentifier=win-x64 -getItem:None > $report
if ($LASTEXITCODE -ne 0) { throw 'Voice packaging item evaluation failed' }
$items = (Get-Content -LiteralPath $report -Raw | ConvertFrom-Json).Items.None
$voice = @($items | Where-Object { $_.Identity -like '*\bin\voice-runtime\*' })
$actual = @(Get-ChildItem (Join-Path $root 'bin/voice-runtime') -File -Recurse | Where-Object { $_.Extension -ne '.pyc' -and $_.FullName -notlike '*\__pycache__\*' })
if ($voice.Count -ne $actual.Count -or $voice.Count -gt 5000) { throw "Incorrect runtime item count: $($voice.Count) vs $($actual.Count)" }
$links = @($voice | ForEach-Object Link)
if (@($links | Sort-Object -Unique).Count -ne $voice.Count) { throw 'Duplicate runtime destination links' }
foreach ($item in $voice) {
    $expected = 'voice\runtime\' + [IO.Path]::GetRelativePath((Join-Path $root 'bin/voice-runtime'), $item.FullPath)
    if ($item.Link -ne $expected) { throw "Invalid runtime destination: $($item.Link)" }
}
if (@($items | Where-Object Link -eq 'voice\worker.py').Count -ne 1) { throw 'Worker script destination missing' }
Write-Output "PASS $($voice.Count) unique runtime destinations, one worker, no metadata cross-product"
