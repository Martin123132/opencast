@echo off
setlocal

cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-shareframe.ps1" %*
set "SHAREFRAME_EXIT=%ERRORLEVEL%"

if not "%SHAREFRAME_EXIT%"=="0" (
  echo.
  echo ShareFrame stopped with exit code %SHAREFRAME_EXIT%.
  pause
)

exit /b %SHAREFRAME_EXIT%
