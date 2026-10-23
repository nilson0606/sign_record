param([switch]$List)
# Stops this project's local services (site 4273, helper 4274) and nothing else. ASCII only (PowerShell 5.1).
# A service is recognised by node.exe running THIS folder's server.mjs / helper-local.mjs:
#   - full path on the command line (any port), or
#   - the bare file name when the process owns the service port or is the PID in .runtime\<name>.pid
# so copies started outside start-local.ps1 (tests, other tools) are found too; other Node programs are never touched.
# The helper is first asked to shut down (it cancels its own jobs and child processes); anything still alive
# afterwards is ended with taskkill /T. Orphaned job processes (python/ffmpeg running files under .runtime\ or
# tools\ whose parent is gone) are ended as well. Finally no other program may hold 4273/4274 (exit code 1 otherwise);
# a socket Windows is still closing (owner PID 0) is only reported, since it frees itself.
# -List only prints what would be stopped.
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskRuntime = Join-Path $taskRoot '.runtime'
$taskServices = @(@{ Name = 'helper'; File = 'helper-local.mjs'; Port = 4274 }, @{ Name = 'site'; File = 'server.mjs'; Port = 4273 })
$taskFailed = $false

function Get-AllProcesses { @(Get-CimInstance Win32_Process) }
function Get-Listeners([int]$Port) { @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }
function Test-Alive([int]$Id) { [bool](Get-CimInstance Win32_Process -Filter "ProcessId=$Id") }
function Stop-Tree([int]$Id) { $ErrorActionPreference = 'Continue'; & taskkill.exe /PID $Id /T /F 2>$null | Out-Null }
function Wait-Exit([int]$Id, [int]$Seconds) {
    for ($i = 0; $i -lt ($Seconds * 5); $i++) { if (-not (Test-Alive $Id)) { return $true }; Start-Sleep -Milliseconds 200 }
    return -not (Test-Alive $Id)
}
function Test-FullPath($Process, [string]$File) {
    ([string]$Process.CommandLine).ToLowerInvariant().Contains((Join-Path $taskRoot $File).ToLowerInvariant())
}
function Test-BareName($Process, [string]$File) {
    # node.exe helper-local.mjs  /  node "./helper-local.mjs"  (started with this folder as working directory)
    ([string]$Process.CommandLine) -match ('(^|[\s"])(\.[\\/])?' + [regex]::Escape($File) + '("|\s|$)')
}
function Find-Service($All, $Service) {
    $found = @{}
    $node = @($All | Where-Object { $_.Name -eq 'node.exe' })
    foreach ($p in $node) { if (Test-FullPath $p $Service.File) { $found[[int]$p.ProcessId] = $p } }
    $ids = @(Get-Listeners $Service.Port | ForEach-Object { [int]$_.OwningProcess })
    $pidFile = Join-Path $taskRuntime ($Service.Name + '.pid')
    if (Test-Path -LiteralPath $pidFile) {
        $saved = 0
        if ([int]::TryParse(([string](Get-Content -LiteralPath $pidFile -Raw)).Trim(), [ref]$saved)) { $ids += $saved }
    }
    foreach ($id in $ids) {
        $p = $node | Where-Object { [int]$_.ProcessId -eq $id }
        if ($p -and ((Test-FullPath $p $Service.File) -or (Test-BareName $p $Service.File))) { $found[$id] = $p }
    }
    @($found.Values)
}
function Find-Orphans($All) {
    $alive = @{}; foreach ($p in $All) { $alive[[int]$p.ProcessId] = $true }
    $marks = @((Join-Path $taskRoot '.runtime\').ToLowerInvariant(), (Join-Path $taskRoot 'tools\').ToLowerInvariant())
    @($All | Where-Object {
        $cmd = ([string]$_.CommandLine).ToLowerInvariant()
        $_.Name -ne 'node.exe' -and [int]$_.ProcessId -ne $PID -and -not $alive.ContainsKey([int]$_.ParentProcessId) -and
            (@($marks | Where-Object { $cmd.Contains($_) }).Count -gt 0)
    })
}
function Describe($p) { 'PID ' + $p.ProcessId + ' ' + $p.Name + ' ' + ([string]$p.CommandLine) }

$all = Get-AllProcesses
$found = @{}
foreach ($s in $taskServices) { $found[$s.Name] = @(Find-Service $all $s) }
$orphans = @(Find-Orphans $all)

if ($List) {
    foreach ($s in $taskServices) {
        if ($found[$s.Name].Count -eq 0) { Write-Host ($s.Name + ': not running') }
        foreach ($p in $found[$s.Name]) { Write-Host ($s.Name + ': ' + (Describe $p)) }
    }
    foreach ($p in $orphans) { Write-Host ('orphan job: ' + (Describe $p)) }
    foreach ($s in $taskServices) {
        foreach ($c in (Get-Listeners $s.Port)) {
            if (-not ($found[$s.Name] | Where-Object { [int]$_.ProcessId -eq [int]$c.OwningProcess })) { Write-Host ('port ' + $s.Port + ' also held by PID ' + $c.OwningProcess + ' (not this project; left alone)') }
        }
    }
    exit 0
}

# 1. Helper: polite shutdown through its own API (cancels jobs, ends its child processes), then force what is left.
$helpers = $found['helper']
$owner = @(Get-Listeners 4274 | Where-Object { $o = [int]$_.OwningProcess; $helpers | Where-Object { [int]$_.ProcessId -eq $o } })
if ($owner.Count -gt 0) {
    try {
        $taskHeaders = @{ Origin = 'http://localhost:4273' }
        $taskSession = Invoke-RestMethod -Uri 'http://127.0.0.1:4274/session' -Headers $taskHeaders -TimeoutSec 5
        $taskHeaders['X-Karaoke-Token'] = $taskSession.token
        Invoke-RestMethod -Uri 'http://127.0.0.1:4274/shutdown' -Method Post -Headers $taskHeaders -TimeoutSec 20 | Out-Null
        if (Wait-Exit ([int]$owner[0].OwningProcess) 20) { Write-Host ('helper stopped (PID ' + $owner[0].OwningProcess + ').') }
    } catch { Write-Host ('helper did not answer the shutdown request: ' + $_.Exception.Message) }
}
foreach ($s in $taskServices) {
    foreach ($p in $found[$s.Name]) {
        if (Test-Alive ([int]$p.ProcessId)) {
            Stop-Tree ([int]$p.ProcessId)
            if (Wait-Exit ([int]$p.ProcessId) 10) { Write-Host ($s.Name + ' stopped (PID ' + $p.ProcessId + ').') }
            else { Write-Host ('WARNING: ' + $s.Name + ' PID ' + $p.ProcessId + ' could not be stopped.'); $taskFailed = $true }
        }
    }
}
# 2. Job processes left behind by an earlier helper that is already gone.
foreach ($p in $orphans) {
    if (Test-Alive ([int]$p.ProcessId)) { Stop-Tree ([int]$p.ProcessId); Write-Host ('orphan job stopped: ' + (Describe $p)) }
}
foreach ($s in $taskServices) {
    $pidFile = Join-Path $taskRuntime ($s.Name + '.pid')
    if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -ErrorAction SilentlyContinue }
}
# 3. Both ports must really be free (a dead program's socket can linger for a few seconds).
foreach ($s in $taskServices) {
    for ($i = 0; $i -lt 50 -and (Get-Listeners $s.Port).Count -gt 0; $i++) { Start-Sleep -Milliseconds 200 }
    $left = @(Get-Listeners $s.Port)
    if (@($left | Where-Object { [int]$_.OwningProcess -ne 0 }).Count -gt 0) {
        Write-Host ('WARNING: port ' + $s.Port + ' is still in use by PID ' + (($left | ForEach-Object { $_.OwningProcess } | Select-Object -Unique) -join ', ') + '.')
        $taskFailed = $true
    } elseif ($left.Count -gt 0) {
        # PID 0 = the program is gone and Windows is still closing its old connections; it frees itself.
        Write-Host ('NOTE: Windows is still releasing port ' + $s.Port + ' (connections of the stopped program are closing); it clears by itself.')
    }
}
if ($found['helper'].Count -eq 0 -and $found['site'].Count -eq 0 -and $orphans.Count -eq 0 -and -not $taskFailed) { Write-Host 'Nothing to stop (this project only).' }
if ($taskFailed) { exit 1 }
