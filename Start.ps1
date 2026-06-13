# Personal Assistant - Task Manager Launcher
$projectDir = Join-Path $PSScriptRoot "TaskManager"

# Check .NET
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    Write-Error "dotnet SDK not found. Install from https://dotnet.microsoft.com/download"
    exit 1
}

# Kill any previous instance on port 5199
$existing = Get-NetTCPConnection -LocalPort 5199 -ErrorAction SilentlyContinue
if ($existing) {
    $pid = ($existing | Select-Object -First 1).OwningProcess
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Write-Host "Starting Task Manager..." -ForegroundColor Cyan
Set-Location $projectDir
Start-Process -FilePath "dotnet" -ArgumentList "run" -NoNewWindow -PassThru | Out-Null

# Wait for server
$ready = $false
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:5199" -UseBasicParsing -ErrorAction Stop
        $ready = $true
        break
    } catch {}
}

if ($ready) {
    Write-Host "Ready at http://localhost:5199" -ForegroundColor Green
    Start-Process "http://localhost:5199"
} else {
    Write-Host "Server may still be starting. Open http://localhost:5199 manually." -ForegroundColor Yellow
}
