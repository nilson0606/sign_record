$ErrorActionPreference = 'Stop'
$taskRuntime = Join-Path $PSScriptRoot '.runtime'
foreach ($taskService in @(@{ Name = 'helper'; File = 'helper-local.mjs'; Port = 4274 }, @{ Name = 'site'; File = 'server.mjs'; Port = 4273 })) {
    $taskPidFile = Join-Path $taskRuntime ($taskService.Name + '.pid')
    if (-not (Test-Path -LiteralPath $taskPidFile)) { continue }
    $taskProcessId = [int](Get-Content -LiteralPath $taskPidFile -Raw)
    $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId"
    $taskExpected = Join-Path $PSScriptRoot $taskService.File
    if ($taskProcess) {
        if (-not $taskProcess.CommandLine -or -not $taskProcess.CommandLine.Contains(('"' + $taskExpected + '"'))) { throw 'PID belongs to another process; left it untouched.' }
        if ($taskService.Name -eq 'helper') {
            $taskListener = @(Get-NetTCPConnection -State Listen -LocalPort $taskService.Port -ErrorAction SilentlyContinue)
            if ($taskListener.Count -ne 1 -or $taskListener[0].OwningProcess -ne $taskProcessId) { throw 'Helper port ownership changed; left it untouched.' }
            $taskHeaders = @{ Origin = 'http://localhost:4273' }
            $taskSession = Invoke-RestMethod -Uri 'http://127.0.0.1:4274/session' -Headers $taskHeaders -TimeoutSec 5
            $taskHeaders['X-Karaoke-Token'] = $taskSession.token
            Invoke-RestMethod -Uri 'http://127.0.0.1:4274/shutdown' -Method Post -Headers $taskHeaders -TimeoutSec 20 | Out-Null
            for ($taskAttempt = 0; $taskAttempt -lt 100; $taskAttempt++) {
                if (-not (Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId")) { break }
                Start-Sleep -Milliseconds 200
            }
            if (Get-CimInstance Win32_Process -Filter "ProcessId=$taskProcessId") { throw 'Helper is still stopping; left it running.' }
        } else {
            Stop-Process -Id $taskProcessId -ErrorAction Stop
        }
        Write-Host ($taskService.Name + ' stopped (this project only).')
    }
    Remove-Item -LiteralPath $taskPidFile
}
