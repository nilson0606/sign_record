param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskRuntime = Join-Path $taskRoot '.runtime'
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskOrigin = @{ Origin = 'http://localhost:4273' }
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null

function Start-ProjectService([string]$Name, [string]$File, [int]$Port) {
    $taskScript = Join-Path $taskRoot $File
    $taskListener = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($taskListener.Count -gt 0) {
        foreach ($taskConnection in $taskListener) {
            $taskOwner = Get-CimInstance Win32_Process -Filter "ProcessId=$($taskConnection.OwningProcess)"
            if (-not $taskOwner.CommandLine -or -not $taskOwner.CommandLine.Contains(('"' + $taskScript + '"'))) {
                throw "Port $Port belongs to another service. It was left untouched."
            }
        }
        $taskListener[0].OwningProcess | Set-Content -LiteralPath (Join-Path $taskRuntime "$Name.pid")
        return
    }
    $taskChild = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskScript + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime "$Name.stdout.log") -RedirectStandardError (Join-Path $taskRuntime "$Name.stderr.log") -PassThru
    $taskChild.Id | Set-Content -LiteralPath (Join-Path $taskRuntime "$Name.pid")
    for ($taskAttempt = 0; $taskAttempt -lt 20; $taskAttempt++) {
        Start-Sleep -Milliseconds 250
        $taskChild.Refresh()
        if ($taskChild.HasExited) { throw "$Name exited. See .runtime/$Name.stderr.log." }
        if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $taskChild.Id }) { return }
    }
    throw "$Name startup timed out. See .runtime/$Name.stderr.log."
}

$taskPreviousPort = $env:PORT
$taskPreviousHelper = $env:KARAOKE_HELPER_PORT
$taskPreviousSite = $env:KARAOKE_SITE_DIR
try {
    $env:PORT = '4273'
    $env:KARAOKE_HELPER_PORT = '4274'
    $env:KARAOKE_SITE_DIR = $taskRoot
    Start-ProjectService 'helper' 'helper-local.mjs' 4274
    $taskStatus = Invoke-RestMethod -Uri 'http://127.0.0.1:4274/health' -Headers $taskOrigin -TimeoutSec 15
    if ($taskStatus.app -ne 'karaoke-local-helper' -or -not $taskStatus.ready) { throw 'Audio environment is not ready. Check .runtime/helper.stderr.log and setup-local.ps1.' }
    Start-ProjectService 'site' 'server.mjs' 4273
    $taskPage = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:4273/' -TimeoutSec 10
    if ($taskPage.StatusCode -ne 200) { throw 'Local web page is not ready.' }
    Write-Host 'Ready: http://localhost:4273/'
    Write-Host 'Local audio helper: http://127.0.0.1:4274 (this project only)'
    if (-not $NoOpen) { Start-Process 'http://localhost:4273/' }
} finally {
    $env:PORT = $taskPreviousPort
    $env:KARAOKE_HELPER_PORT = $taskPreviousHelper
    $env:KARAOKE_SITE_DIR = $taskPreviousSite
}
