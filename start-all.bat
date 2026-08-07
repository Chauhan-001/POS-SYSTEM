@echo off
title Loyalty POS System — Starting All Services
cd /d "%~dp0"

echo ============================================
echo   Loyalty POS System — Starting All Services
echo ============================================
echo.

:: Install packages if node_modules missing
if not exist "backend\node_modules" (
    echo [1/3] Installing Backend dependencies...
    cd backend
    call npm install
    cd ..
) else (
    echo [1/3] Backend dependencies ready.
)

if not exist "admin-dashboard\node_modules" (
    echo [2/3] Installing Admin Dashboard dependencies...
    cd admin-dashboard
    call npm install
    cd ..
) else (
    echo [2/3] Admin Dashboard dependencies ready.
)

if not exist "restaurant-pos\Frontend\node_modules" (
    echo [3/3] Installing POS Frontend dependencies...
    cd restaurant-pos\Frontend
    call npm install
    cd ..\..
) else (
    echo [3/3] POS Frontend dependencies ready.
)

echo.
echo Starting all services in separate windows...
echo.
echo   Backend        →  http://localhost:3002
echo   Admin Dashboard →  http://localhost:5174
echo   POS System      →  http://localhost:5173
echo.
echo Close the windows or press Ctrl+C to stop each service.
echo ============================================
echo.

:: Start each service in its own terminal window
start "Backend API" cmd /c "cd /d %~dp0backend && echo Backend starting on port 3002... && set PORT=3002 && npm run dev"
timeout /t 2 /nobreak >nul

start "Admin Dashboard" cmd /c "cd /d %~dp0admin-dashboard && echo Admin Dashboard starting on port 5174... && npm run dev:web"
timeout /t 2 /nobreak >nul

start "POS System" cmd /c "cd /d %~dp0restaurant-pos\Frontend && echo POS System starting on port 5173... && npm run dev"

echo.
echo All services started! Open the URLs above in your browser.
echo.
pause
