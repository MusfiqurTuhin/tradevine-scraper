@echo off
title Tradevine Scraper Launcher

echo ----------------------------------------
echo 🚀 Tradevine Scraper: Starting Setup...
echo ----------------------------------------

:: 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ ERROR: Node.js is not installed.
    echo Please download it from: https://nodejs.org/
    pause
    exit /b
)

:: 2. Skip installation if node_modules exists
if exist "node_modules\" (
    echo ✅ Dependencies already installed. Skipping npm install...
) else (
    echo 📦 Installing project dependencies...
    call npm install
    echo 🌐 Installing browser engine...
    npx playwright install chromium
)

:: 3. Open the dashboard in the default browser
echo 🖥️ Opening Dashboard at http://localhost:3000...
start http://localhost:3000

:: 4. Start the server
echo ✅ Everything is ready! Starting the engine...
node server.js
pause
