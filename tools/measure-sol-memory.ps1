param(
    [Parameter(Mandatory=$true)][int]$RootProcessId,
    [ValidateRange(1,180)][int]$DurationSeconds=90,
    [string]$OutputFile='bin/memory-evidence/live-samples.json'
)
$ErrorActionPreference='Stop'
$samples=[Collections.Generic.List[object]]::new()
$endAt=(Get-Date).AddSeconds($DurationSeconds)
do {
    $tree=@(Get-CimInstance Win32_Process)
    if(-not ($tree | Where-Object {$_.ProcessId -eq $RootProcessId -and $_.Name -eq 'Sol.exe'})){break}
    $ids=[Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($RootProcessId)
    do {
        $added=$false
        foreach($entry in $tree){
            if($ids.Contains([int]$entry.ParentProcessId) -and $ids.Add([int]$entry.ProcessId)){$added=$true}
        }
    }while($added)
    $counters=@(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object {$ids.Contains([int]$_.IDProcess)})
    $details=@(foreach($entry in $tree | Where-Object {$ids.Contains([int]$_.ProcessId)}){
        $counter=$counters | Where-Object IDProcess -eq $entry.ProcessId | Select-Object -First 1
        $kind=if($entry.Name -eq 'Sol.exe'){'host'}elseif($entry.Name -match '^python'){'voice'}elseif($entry.CommandLine -match '--extension-process'){'extension'}elseif($entry.CommandLine -match '--type=([^ ]+)'){$Matches[1]}else{$entry.Name}
        [pscustomobject]@{pid=$entry.ProcessId;kind=$kind;privateResidentBytes=$counter.WorkingSetPrivate;privateCommitBytes=$entry.PrivatePageCount;cpuPercent=[math]::Round($counter.PercentProcessorTime/[Environment]::ProcessorCount,2)}
    })
    $sample=[pscustomobject]@{
        observedAt=(Get-Date).ToString('o');processes=$details.Count
        privateResidentBytes=($details | Measure-Object privateResidentBytes -Sum).Sum
        privateCommitBytes=($details | Measure-Object privateCommitBytes -Sum).Sum
        cpuPercent=($details | Measure-Object cpuPercent -Sum).Sum
        voiceProcesses=@($details | Where-Object kind -eq 'voice').Count
        details=$details
    }
    $samples.Add($sample)
    ConvertTo-Json -InputObject @($samples.ToArray()) -Depth 5 | Set-Content -LiteralPath $OutputFile -Encoding utf8
    '{0}: {1:N1} MiB private resident, {2} processes, {3:N1}% CPU, {4} voice' -f $sample.observedAt,($sample.privateResidentBytes/1MB),$sample.processes,$sample.cpuPercent,$sample.voiceProcesses
    if((Get-Date) -ge $endAt){break}
    Start-Sleep -Seconds 15
}while((Get-Date) -lt $endAt)
