@echo off
title Loyalty POS System — Starting All Services as Electron Apps
cd /d "%~dp0"

echo ============================================================
echo   Loyalty POS System — Electron Desktop Mode
echo ============================================================
echo   Starting all services with desktop windows...
echo.
echo   Backend API        →  http://localhost:3002
echo   Admin Dashboard    →  Electron window (port 5174)
echo   POS System         →  Electron window (port 5173)
echo.
echo   Each service opens in its own terminal window.
echo   Close a window to stop that service.
echo ============================================================
echo.

:: ─── Step 1: Check dependencies ───────────────────────────────
echo [CHECK] Verifying dependencies...

if not exist "node_modules\concurrently" (
    echo [INSTALL] Installing root dependencies...
    call npm install
) else (
    echo [OK] Root dependencies ready.
)

if not exist "backend\node_modules" (
    echo [INSTALL] Installing Backend dependencies...
    cd backend
    call npm install
    cd ..
) else (
    echo [OK] Backend dependencies ready.
)

if not exist "admin-dashboard\node_modules" (
    echo [INSTALL] Installing Admin Dashboard dependencies...
    cd admin-dashboard
    call npm install
    cd ..
) else (
    echo [OK] Admin Dashboard dependencies ready.
)

if not exist "restaurant-pos\node_modules" (
    echo [INSTALL] Installing POS root dependencies...
    cd restaurant-pos
    call npm install
    cd ..
) else (
    echo [OK] POS root dependencies ready.
)

if not exist "restaurant-pos\Frontend\node_modules" (
    echo [INSTALL] Installing POS Frontend dependencies...
    cd restaurant-pos\Frontend
    call npm install
    cd ..\..
) else (
    echo [OK] POS Frontend dependencies ready.
)

echo.

:: ─── Step 2: Launch everything ─────────────────────────────────
echo [LAUNCH] Starting all services in separate windows...
echo.
echo   Window 1: Backend API              (port 3002)
echo   Window 2: Admin Dashboard          (Vite + Electron — port 5174)
echo   Window 3: POS Terminal             (Vite port 5173 + Electron)
echo.

:: Start backend (PORT=3002 to match Vite proxy configs)
start "Backend API" cmd /c "title Backend API && cd /d %~dp0backend && echo Backend starting on port 3002... && set PORT=3002 && npm run dev"
timeout /t 3 /nobreak >nul

:: Start Admin Dashboard — runs Vite + Electron together via 'npm run dev'
:: The admin-dashboard's dev script internally uses wait-on to launch
:: Electron only after Vite is ready on port 5174.
start "Admin Dashboard" cmd /c "title Admin Dashboard && cd /d %~dp0admin-dashboard && echo Admin Dashboard starting Vite + Electron... && npm run dev"
timeout /t 2 /nobreak >nul

:: Start POS Terminal — uses root dev:pos:electron script which waits for
:: Vite on port 5173 before launching the POS Electron window.
start "POS Terminal" cmd /c "title POS Terminal && cd /d %~dp0 && echo POS Terminal starting Vite + Electron... && npm run dev:pos:electron"

echo.
echo ============================================================
echo   All services launched!
echo.
echo   • Two Electron desktop windows should appear shortly:
echo     1. Admin Dashboard
echo     2. POS Terminal
echo.
echo   • Close a terminal window to stop that service.
echo   • Press Ctrl+C in the backend window to stop the API.
echo ============================================================
echo.
pause
