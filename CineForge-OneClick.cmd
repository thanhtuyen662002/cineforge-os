@echo off
setlocal
rem Double-click this file to build the verified portable CineForge.exe and open it.
call "%~dp0packaging\build_windows.cmd" -Mode Portable %*
if errorlevel 1 exit /b %ERRORLEVEL%
start "CineForge" "%~dp0dist\CineForge\CineForge.exe"
