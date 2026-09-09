param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$repoPath = Split-Path -Parent $PSScriptRoot
$frontendPath = Join-Path $repoPath 'frontend'
$buildPath = Join-Path $frontendPath 'dist/local-preview'
$backendPath = Join-Path $repoPath 'backend'
$nodePath = (Get-Command node -ErrorAction Stop).Source
$vitePath = Join-Path $frontendPath 'node_modules/vite/bin/vite.js'
$backendEntry = Join-Path $backendPath 'src/server.js'
$previewUrl = 'http://localhost:5173'
$apiUrl = 'http://127.0.0.1:3000/api'
$logPath = Join-Path $repoPath 'output'
$runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Get-LocalServer([int]$Port, [string]$ExpectedEntry) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $listener) { return $null }
    $server = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
    $command = [string]$server.CommandLine
    if (-not $command.Replace('\', '/').Contains($ExpectedEntry.Replace('\', '/'))) {
        throw "Port $Port belongs to another process (PID $($listener.OwningProcess)). Close that server or use its preview; no process was stopped."
    }
    return Get-Process -Id $listener.OwningProcess
}

function Wait-LocalServer([string]$Url, $Server, [string]$ErrorLog) {
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        $Server.Refresh()
        if ($Server.HasExited) { throw "Server exited before $Url was ready. See $ErrorLog" }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for $Url. See $ErrorLog"
}

# Resolve occupied ports before building or starting anything. Never terminate
# an unrelated task's server to make room for this preview.
$apiServer = Get-LocalServer 3000 $backendEntry
$previewServer = Get-LocalServer 5173 $buildPath
if (-not (Test-Path -LiteralPath (Join-Path $backendPath '.env'))) {
    throw 'Create backend/.env from backend/.env.example before starting the local preview.'
}
if (-not (Test-Path -LiteralPath $vitePath)) {
    throw 'Frontend dependencies are missing. Install them in frontend before starting the preview.'
}

if (-not $SkipBuild) {
    $previousApiUrl = $env:VITE_API_BASE_URL
    $previousOutDir = $env:KIRANA_OUT_DIR
    $env:VITE_API_BASE_URL = $apiUrl
    $env:KIRANA_OUT_DIR = $buildPath
    Push-Location $frontendPath
    try {
        & $nodePath $vitePath build --configLoader runner --config vite.config.ts
        if ($LASTEXITCODE -ne 0) { throw "Preview build failed (exit $LASTEXITCODE)." }
    } finally {
        Pop-Location
        $env:VITE_API_BASE_URL = $previousApiUrl
        $env:KIRANA_OUT_DIR = $previousOutDir
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $buildPath 'index.html'))) {
    throw 'The preview build is missing. Run this script without -SkipBuild.'
}

New-Item -ItemType Directory -Path $logPath -Force | Out-Null
$apiErrorLog = Join-Path $logPath "local-preview-api-$runStamp.err.log"
if (-not $apiServer) {
    $apiServer = Start-Process -FilePath $nodePath -ArgumentList @(
        '--import', './src/instrumentation.js',
        ('"' + $backendEntry + '"')
    ) -WorkingDirectory $backendPath -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logPath "local-preview-api-$runStamp.log") `
        -RedirectStandardError $apiErrorLog
}
Wait-LocalServer 'http://127.0.0.1:3000/health/ready' $apiServer $apiErrorLog

$previewErrorLog = Join-Path $logPath "local-preview-web-$runStamp.err.log"
if (-not $previewServer) {
    $previousOutDir = $env:KIRANA_OUT_DIR
    $env:KIRANA_OUT_DIR = $buildPath
    try {
        $previewServer = Start-Process -FilePath $nodePath -ArgumentList @(
            ('"' + $vitePath + '"'), 'preview', '--configLoader', 'runner',
            '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', '5173', '--strictPort',
            '--outDir', ('"' + $buildPath + '"')
        ) -WorkingDirectory $frontendPath -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logPath "local-preview-web-$runStamp.log") `
            -RedirectStandardError $previewErrorLog
    } finally {
        $env:KIRANA_OUT_DIR = $previousOutDir
    }
}
# Probe the address Vite binds directly; localhost can try IPv6 first on Windows.
Wait-LocalServer 'http://127.0.0.1:5173/' $previewServer $previewErrorLog

Write-Output "Preview ready: $previewUrl"
Write-Output "API ready: $apiUrl (PID $($apiServer.Id)); preview PID $($previewServer.Id)."
Write-Output "Servers keep running after this command exits. Logs: $logPath"
