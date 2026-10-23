# Mocked check for start-local.ps1 (runs anywhere with PowerShell 7: pwsh -NoProfile -File tests/start-local-check.ps1).
# Windows-only commands (Get-CimInstance, Get-NetTCPConnection, taskkill, the helper API) are replaced by
# an in-memory process/port table, so nothing real is started or stopped. Prints SUMMARY n/m; exit 1 on failure.
$root = Join-Path ([System.IO.Path]::GetTempPath()) ('karaoke-ps-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $root '.runtime') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\start-local.ps1') -Destination $root
$rt = Join-Path $root '.runtime'
$hl = Join-Path $root 'helper-local.mjs'; $sv = Join-Path $root 'server.mjs'; $rm = Join-Path $root '.runtime\'; $tm = Join-Path $root 'tools\'
function P($id,$name,$cmd){[pscustomobject]@{ProcessId=$id;Name=$name;CommandLine=$cmd}}
$global:procs=@(); $global:listen=@(); $global:sleeps=0; $global:linger=-1; $global:started=@(); $global:childExits=$false
function global:Get-Command { [pscustomobject]@{Source='C:\node.exe'} }
function global:Get-CimInstance { param($ClassName,[string]$Filter) if($Filter -match 'ProcessId=(\d+)'){ $i=[int]$Matches[1]; return $global:procs | ? { $_.ProcessId -eq $i } }; $global:procs }
function global:Get-NetTCPConnection { param($State,[int[]]$LocalPort,$ErrorAction) @($global:listen | ? { $LocalPort -contains $_.LocalPort -and -not ($_.OwningProcess -eq 0 -and $global:linger -ge 0 -and $global:sleeps -ge $global:linger) }) }
function global:Start-Sleep { param($Milliseconds) $global:sleeps++ }
function global:Start-Process { param($FilePath,$ArgumentList,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,[switch]$PassThru)
  if (-not $PassThru) { return }
  $id = 1000 + $global:started.Count; $global:started += $ArgumentList
  $port = if ($ArgumentList -like '*helper-local*') { 4274 } else { 4273 }
  if ($global:childExits) { 'listen EADDRINUSE: address already in use 127.0.0.1:4274' | Set-Content $RedirectStandardError; $o=[pscustomobject]@{Id=$id;HasExited=$true}; $o | Add-Member ScriptMethod Refresh {}; return $o }
  $global:procs += P $id 'node.exe' ('"C:\node.exe" ' + $ArgumentList); $global:listen += [pscustomobject]@{LocalPort=$port;OwningProcess=$id}
  $o=[pscustomobject]@{Id=$id;HasExited=$false}; $o | Add-Member ScriptMethod Refresh {}; $o }
function global:Invoke-RestMethod { [pscustomobject]@{app='karaoke-local-helper';ready=$true} }
function global:Invoke-WebRequest { [pscustomobject]@{StatusCode=200} }
$res=@(); function Check($n,$ok,$i=''){ $global:res+=[bool]$ok; Write-Host ((&{if($ok){'PASS '}else{'FAIL '}})+$n+' '+$i) }
function Reset { $global:procs=@((P 0 'System Idle Process' '')); $global:listen=@(); $global:sleeps=0; $global:linger=-1; $global:started=@(); $global:childExits=$false; Remove-Item "$rt/*" -ErrorAction SilentlyContinue }
function Run { try { $o = & "$root/start-local.ps1" -NoOpen *>&1 | Out-String; @{ok=$true;out=$o} } catch { @{ok=$false;out=$_.Exception.Message} } }
Reset; $r=Run; Check '1 clean start: both started' ($r.ok -and $global:started.Count -eq 2 -and (Get-Content "$rt/helper.pid") -eq '1000') $r.out
Reset; $global:listen=@([pscustomobject]@{LocalPort=4274;OwningProcess=0}); $global:linger=8; $r=Run
Check '2 lingering PID 0 socket that clears -> waits, then starts' ($r.ok -and $global:started.Count -eq 2) $r.out
Reset; $global:listen=@([pscustomobject]@{LocalPort=4274;OwningProcess=0}); $r=Run
Check '3 socket held by something else -> clear error, nothing started' ((-not $r.ok) -and $r.out -match 'Port 4274 is held by another program \(PID 0\)' -and $r.out -match 'stop-local.ps1 -List' -and $global:started.Count -eq 0) $r.out
Reset; $global:procs += P 77 'node.exe' "`"C:\node.exe`" `"$hl`""; $global:listen=@([pscustomobject]@{LocalPort=4274;OwningProcess=77}); $r=Run
Check '4 our helper already running -> adopted (pid 77), site started' ($r.ok -and (Get-Content "$rt/helper.pid") -eq '77' -and $global:started.Count -eq 1) $r.out
Reset; $global:childExits=$true; $r=Run
Check '5 helper exits at start -> error shows the stderr line' ((-not $r.ok) -and $r.out -match 'helper exited' -and $r.out -match 'EADDRINUSE') $r.out
$ok = @($res | ? { $_ }).Count; Write-Host ("SUMMARY {0}/{1}" -f $ok, $res.Count)
Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
if ($ok -ne $res.Count) { exit 1 }
