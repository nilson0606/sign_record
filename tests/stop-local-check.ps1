# Mocked check for stop-local.ps1 (runs anywhere with PowerShell 7: pwsh -NoProfile -File tests/stop-local-check.ps1).
# Windows-only commands (Get-CimInstance, Get-NetTCPConnection, taskkill, the helper API) are replaced by
# an in-memory process/port table, so nothing real is started or stopped. Prints SUMMARY n/m; exit 1 on failure.
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('karaoke-ps-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $root '.runtime') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\stop-local.ps1') -Destination $root
$rt = Join-Path $root '.runtime'
$hl = Join-Path $root 'helper-local.mjs'; $sv = Join-Path $root 'server.mjs'; $rm = Join-Path $root '.runtime\'; $tm = Join-Path $root 'tools\'
$global:procs = @(); $global:listen = @(); $global:calls = @(); $global:sleeps = 0; $global:lingerUntil = -1; $global:shutdownWorks = $true
function P($id, $parent, $name, $cmd) { [pscustomobject]@{ ProcessId = $id; ParentProcessId = $parent; Name = $name; CommandLine = $cmd } }
function Kill-Tree($id) {
  $kids = @($global:procs | Where-Object { $_.ParentProcessId -eq $id }); foreach ($k in $kids) { Kill-Tree $k.ProcessId }
  $global:procs = @($global:procs | Where-Object { $_.ProcessId -ne $id }); $global:listen = @($global:listen | Where-Object { $_.OwningProcess -ne $id })
}
function global:Get-CimInstance { param([string]$ClassName, [string]$Filter)
  if ($Filter -match 'ProcessId=(\d+)') { $id = [int]$Matches[1]; return $global:procs | Where-Object { $_.ProcessId -eq $id } }
  return $global:procs }
function global:Get-NetTCPConnection { param($State, [int[]]$LocalPort, $ErrorAction)
  $global:sleeps | Out-Null
  @($global:listen | Where-Object { $LocalPort -contains $_.LocalPort -and -not ($_.OwningProcess -eq 0 -and $global:lingerUntil -ge 0 -and $global:sleeps -ge $global:lingerUntil) }) }
function global:taskkill.exe { $id = [int]$args[1]; $global:calls += "taskkill $id"; Kill-Tree $id }
function global:Start-Sleep { param($Milliseconds) $global:sleeps++ }
function global:Invoke-RestMethod { param($Uri, $Method, $Headers, $TimeoutSec)
  $global:calls += "rest $Uri"
  if (-not $global:shutdownWorks) { throw 'connection refused' }
  if ($Uri -like '*/session') { return [pscustomobject]@{ token = 'tok' } }
  if ($Headers['X-Karaoke-Token'] -ne 'tok' -or $Headers['Origin'] -ne 'http://localhost:4273') { throw 'bad headers' }
  $o = $global:listen | Where-Object { $_.LocalPort -eq 4274 } | Select-Object -First 1; if ($o) { Kill-Tree $o.OwningProcess }; return [pscustomobject]@{ stopped = $true } }
$res = @()
function Check($name, $ok, $info = '') { $global:res += [bool]$ok; Write-Host (($(if ($ok) { 'PASS ' } else { 'FAIL ' })) + $name + ' ' + $info) }
function Run([switch]$List) { $global:calls = @(); $global:sleeps = 0; $global:LASTEXITCODE = 0; $out = if ($List) { & "$root/stop-local.ps1" -List *>&1 | Out-String } else { & "$root/stop-local.ps1" *>&1 | Out-String }; return @{ out = $out; code = $LASTEXITCODE } }
function Reset { $global:procs = @(); $global:listen = @(); $global:lingerUntil = -1; $global:shutdownWorks = $true; Remove-Item "$rt/*.pid" -ErrorAction SilentlyContinue }
$codex = @((P 31368 14548 'codex.exe' "codex.exe sandbox ... `"D:\\sign_record`" = `"write`" -- node.exe kernel.js --working-dir $root"), (P 4772 34424 'node.exe' "node.exe --eval x C:\tmp\trusted-worker.js $root"), (P 14548 1 'Codex.exe' 'Codex.exe'), (P 34424 1 'x.exe' 'x'))
$other = @((P 900 1 'node.exe' 'node server.mjs'), (P 1 0 'System' ''), (P 0 0 'System Idle Process' ''))

# A normal start-local session
Reset; $global:procs = $codex + $other + @((P 100 50 'node.exe' "`"C:\node.exe`" `"$hl`""), (P 101 100 'python.exe' "py ${rm}jobs\x"), (P 200 50 'node.exe' "`"C:\node.exe`" `"$sv`""))
$global:listen = @([pscustomobject]@{LocalPort=4274;OwningProcess=100}, [pscustomobject]@{LocalPort=4273;OwningProcess=200}, [pscustomobject]@{LocalPort=5000;OwningProcess=900})
'100' | Set-Content "$rt/helper.pid"; '200' | Set-Content "$rt/site.pid"
$r = Run
Check 'A helper asked to shut down via its API' (($global:calls -join ',') -like '*rest http://127.0.0.1:4274/session*rest http://127.0.0.1:4274/shutdown*') ($global:calls -join ',')
Check 'A helper, its python child and site gone' (-not ($global:procs | Where-Object { $_.ProcessId -in 100,101,200 })) ($r.out)
Check 'A codex and other node untouched' (@($global:procs | Where-Object { $_.ProcessId -in 31368,4772,900 }).Count -eq 3)
Check 'A pid files removed, exit 0' ((-not (Test-Path "$rt/helper.pid")) -and (-not (Test-Path "$rt/site.pid")) -and $r.code -eq 0) "code=$($r.code)"

# B leftover helper not in pid file (today's case) + stale pid file + site not running
Reset; $global:procs = $codex + $other + @((P 23732 1 'node.exe' "`"C:\Program Files\nodejs\node.exe`" `"$hl`""))
$global:listen = @([pscustomobject]@{LocalPort=4274;OwningProcess=23732}); '28788' | Set-Content "$rt/helper.pid"; '28204' | Set-Content "$rt/site.pid"
$r = Run
Check 'B leftover helper (not in pid file) stopped' (-not ($global:procs | Where-Object ProcessId -eq 23732)) $r.out
Check 'B exit 0, codex untouched' ($r.code -eq 0 -and @($global:procs | Where-Object { $_.ProcessId -in 31368,4772 }).Count -eq 2)

# C helper not listening, started with bare name and only known through pid file; another project's server.mjs on 4273
Reset; $global:procs = $codex + $other + @((P 300 1 'node.exe' 'node.exe helper-local.mjs'), (P 400 1 'node.exe' 'node C:\other\server.mjs'))
$global:listen = @([pscustomobject]@{LocalPort=4273;OwningProcess=400}); '300' | Set-Content "$rt/helper.pid"
$r = Run
Check 'C bare-name helper from pid file stopped (taskkill)' ((-not ($global:procs | Where-Object ProcessId -eq 300)) -and ($global:calls -contains 'taskkill 300')) ($global:calls -join ',')
Check 'C other project server.mjs on 4273 left alone, reported, exit 1' ((@($global:procs | Where-Object ProcessId -eq 400).Count -eq 1) -and $r.code -eq 1 -and $r.out -match 'port 4273 is still in use by PID 400') $r.out
Check 'C bare "node server.mjs" on port 5000 untouched' (@($global:procs | Where-Object ProcessId -eq 900).Count -eq 1)

# D orphan job processes
Reset; $global:procs = $codex + $other + @((P 500 777 'python.exe' "py ${rm}venv\Scripts\python.exe sep.py"), (P 501 500 'ffmpeg.exe' 'ffmpeg -i a'), (P 600 650 'python.exe' "${rm}venv\Scripts\python.exe lead"), (P 650 1 'python.exe' 'webui_server.py'), (P 700 1 'python.exe' "py ${tm}x.py"), (P 710 1 'python.exe' 'py C:\elsewhere\.runtime\x.py'))
$r = Run
Check 'D orphan python (parent gone) and its ffmpeg child stopped' (-not ($global:procs | Where-Object { $_.ProcessId -in 500,501 })) $r.out
Check 'D sign_record venv python with a live parent (AI Cover separation) untouched' (@($global:procs | Where-Object ProcessId -eq 600).Count -eq 1)
Check 'D tools\ script whose parent (PID 1) is alive untouched; other folders untouched' (@($global:procs | Where-Object { $_.ProcessId -in 700,710 }).Count -eq 2)

# E lingering PID 0 socket: clears after a few seconds -> ok; never clears -> exit 1
Reset; $global:procs = $other; $global:listen = @([pscustomobject]@{LocalPort=4274;OwningProcess=0}); $global:lingerUntil = 10
$r = Run; Check 'E lingering socket that clears in time -> exit 0' ($r.code -eq 0) $r.out
Reset; $global:procs = $other; $global:listen = @([pscustomobject]@{LocalPort=4274;OwningProcess=0})
$r = Run; Check 'E socket that never clears -> warning, exit 1, nothing killed' ($r.code -eq 1 -and $r.out -match 'port 4274 is still in use by PID 0' -and -not ($global:calls -match 'taskkill')) $r.out

# F helper does not answer -> forced
Reset; $global:procs = $other + @((P 100 1 'node.exe' "node `"$hl`""), (P 101 100 'python.exe' 'py job')); $global:listen = @([pscustomobject]@{LocalPort=4274;OwningProcess=100}); $global:shutdownWorks = $false
$r = Run; Check 'F unresponsive helper forced with taskkill /T (child too), exit 0' ((-not ($global:procs | Where-Object { $_.ProcessId -in 100,101 })) -and $r.code -eq 0 -and $r.out -match 'did not answer') $r.out

# G -List kills nothing
Reset; $global:procs = $codex + $other + @((P 100 1 'node.exe' "node `"$hl`""), (P 500 777 'python.exe' "py ${rm}jobs\a")); $global:listen = @([pscustomobject]@{LocalPort=4274;OwningProcess=100}, [pscustomobject]@{LocalPort=4273;OwningProcess=0})
$r = Run -List
Check 'G -List prints helper/orphan/foreign port and stops nothing' ($r.out -match 'helper: PID 100' -and $r.out -match 'site: not running' -and $r.out -match 'orphan job: PID 500' -and $r.out -match 'port 4273 also held by PID 0' -and $global:calls.Count -eq 0 -and @($global:procs).Count -eq 9) $r.out

# H nothing running
Reset; $global:procs = $codex + $other
$r = Run; Check 'H nothing running -> Nothing to stop, exit 0' ($r.code -eq 0 -and $r.out -match 'Nothing to stop') $r.out
$ok = @($res | Where-Object { $_ }).Count; Write-Host ("SUMMARY {0}/{1}" -f $ok, $res.Count)
Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
if ($ok -ne $res.Count) { exit 1 }
