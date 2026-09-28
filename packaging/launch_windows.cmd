@echo off
setlocal
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_windows.ps1" %*
exit /b %ERRORLEVEL%
