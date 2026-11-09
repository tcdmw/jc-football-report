@echo off
chcp 65001 >nul
rem run.bat - run the full local pipeline (pwsh 7 first, fallback to Windows PowerShell)
where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
)
pause
