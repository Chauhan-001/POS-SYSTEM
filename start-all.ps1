#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Starts all three Loyalty POS System services concurrently.
.DESCRIPTION
    Launches the Backend API, Admin Dashboard, and POS Frontend
    in separate PowerShell windows with color-coded output.
#>

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ErrorActionPreference = "Stop"

# ─── Color helpers ───────────────────────────────────────────────
$colors = @{
    Info    = "Cyan"
    Success = "Green"
    Warn    = "Yellow"
    Error   = "Red"
}

function Write-Color($text, $color) {
    Write-Host $text -ForegroundColor $color
}

# ─── Header ──────────────────────────────────────────────────────
Clear-Host
Write-Color "============================================" $colors.Info
Write-Color "  Loyalty POS System — Starting All Services" $colors.Info
Write-Color "============================================" $colors.Info
Write-Host ""

# ─── Dependency check ────────────────────────────────────────────
$projects = @(
    @{ Name = "Backend";        Path = "backend";                    Cmd = "npm run dev";                    Port = 3002; Env = @{ PORT = "3002" } }
    @{ Name = "Admin Dashboard"; Path = "admin-dashboard";            Cmd = "npm run dev:web";                Port = 5174; Env = @{} }
    @{ Name = "POS System";      Path = "restaurant-pos\Frontend";    Cmd = "npm run dev";                    Port = 5173; Env = @{} }
)

foreach ($proj in $projects) {
    $projPath = Join-Path $rootDir $proj.Path
    $nodeModules = Join-Path $projPath "node_modules"

    if (-not (Test-Path $nodeModules)) {
        Write-Color "  [$($proj.Name)] Installing dependencies..." $colors.Warn
        Push-Location $projPath
        npm install --silent
        Pop-Location
        Write-Color "  [$($proj.Name)] Dependencies installed." $colors.Success
    } else {
        Write-Color "  [$($proj.Name)] Dependencies ready." $colors.Success
    }
}

Write-Host ""

# ─── Launch each service ─────────────────────────────────────────
$ports = @()
$powershell = if ($IsWindows -or $env:OS -eq "Windows_NT") { "powershell" } else { "pwsh" }

foreach ($proj in $projects) {
    $projPath = Join-Path $rootDir $proj.Path
    $port = $proj.Port
    $encodedCmd = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes(
        "`$host.UI.RawUI.WindowTitle = '$($proj.Name)'; " +
        "Write-Host '========================================' -ForegroundColor Cyan; " +
        "Write-Host '  $($proj.Name) — Port $port' -ForegroundColor Cyan; " +
        "Write-Host '========================================' -ForegroundColor Cyan; " +
        "Set-Location '$projPath'; " +
        $(if ($proj.Env.PORT) { "`$env:PORT = '$($proj.Env.PORT)'; " } else { "" }) +
        "npm run $($proj.Cmd -replace 'npm run ', ''); " +
        "Read-Host '`nPress Enter to close...'"
    ))

    Start-Process -WindowStyle Normal -FilePath $powershell -ArgumentList "-NoExit", "-EncodedCommand", $encodedCmd
    Start-Sleep -Seconds 2

    $ports += @{ Name = $proj.Name; Url = "http://localhost:$port" }
}

# ─── Summary ─────────────────────────────────────────────────────
Write-Color "============================================" $colors.Success
Write-Color "  All services launched!" $colors.Success
Write-Color "============================================" $colors.Success
Write-Host ""

foreach ($p in $ports) {
    Write-Host "  $($p.Name): " -NoNewline
    Write-Color $p.Url $colors.Info
}

Write-Host ""
Write-Color "  Close each service window to stop it." $colors.Warn
Write-Color "============================================" $colors.Success
Write-Host ""

# Keep root window open
Read-Host "Press Enter to close this window"
