@echo off
cd /d "%~dp0"
echo ============================================
echo   MHC Causelist - Fetching tomorrow's cases
echo ============================================
if not exist "node_modules" (
    echo Installing dependencies, please wait...
    call npm install
)
node --use-system-ca mhc_cases.js
echo.
echo Done. The PDF is in the pdfs folder.
pause
