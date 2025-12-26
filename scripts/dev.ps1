# Development Script - Start all services
# Usage: .\scripts\dev.ps1

param(
    [switch]$BackendOnly,
    [switch]$ElectronOnly
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Focus App Development Server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Start Python backend
if (-not $ElectronOnly) {
    Write-Host "`n[1/2] Starting Python backend..." -ForegroundColor Yellow
    $backendPath = Join-Path $ProjectRoot "backend"

    # Check if venv exists
    $venvPath = Join-Path $backendPath "venv\Scripts\Activate.ps1"
    if (-not (Test-Path $venvPath)) {
        Write-Host "  Creating Python virtual environment..." -ForegroundColor Gray
        Push-Location $backendPath
        python -m venv venv
        .\venv\Scripts\Activate.ps1
        pip install -r requirements.txt
        Pop-Location
    }

    # Start backend in new window
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-Command",
        "cd '$backendPath'; .\venv\Scripts\Activate.ps1; Write-Host 'Starting uvicorn...' -ForegroundColor Green; uvicorn app.main:app --reload --port 8000"
    ) -WindowStyle Normal

    Write-Host "  Backend starting on http://localhost:8000" -ForegroundColor Green
}

# Wait for backend to be ready
if (-not $ElectronOnly -and -not $BackendOnly) {
    Write-Host "`n  Waiting for backend to be ready..." -ForegroundColor Gray
    Start-Sleep -Seconds 3
}

# Start Electron app
if (-not $BackendOnly) {
    Write-Host "`n[2/2] Starting Electron app..." -ForegroundColor Yellow
    $electronPath = Join-Path $ProjectRoot "electron"

    # Check if node_modules exists
    $nodeModulesPath = Join-Path $electronPath "node_modules"
    if (-not (Test-Path $nodeModulesPath)) {
        Write-Host "  Installing npm dependencies..." -ForegroundColor Gray
        Push-Location $electronPath
        npm install
        Pop-Location
    }

    # Start Electron in new window
    Start-Process powershell -ArgumentList @(
        "-NoExit",
        "-Command",
        "cd '$electronPath'; Write-Host 'Starting Electron dev server...' -ForegroundColor Green; npm run dev"
    ) -WindowStyle Normal

    Write-Host "  Electron app starting..." -ForegroundColor Green
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Development servers started!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nEndpoints:"
Write-Host "  - Backend API:  http://localhost:8000" -ForegroundColor Gray
Write-Host "  - API Docs:     http://localhost:8000/docs" -ForegroundColor Gray
Write-Host "  - Electron:     http://localhost:5173 (Vite dev)" -ForegroundColor Gray

Write-Host "`nPress Ctrl+C in each window to stop." -ForegroundColor Yellow
