@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 and reopen this launcher.
  pause
  exit /b 1
)
node serve.mjs
pause
