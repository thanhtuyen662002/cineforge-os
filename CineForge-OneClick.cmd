@echo off
setlocal
rem Double-click this file to open the verified portable CineForge.exe.
rem A packaged artifact is self-contained; only a source checkout without an
rem artifact falls back to the developer build path.
if "%~1"=="" if exist "%~dp0dist\CineForge\CineForge.exe" if exist "%~dp0dist\CineForge\build-manifest.json" (
    start "CineForge" "%~dp0dist\CineForge\CineForge.exe"
    exit /b 0
)
call "%~dp0packaging\build_windows.cmd" -Mode Portable %*
if errorlevel 1 exit /b %ERRORLEVEL%
start "CineForge" "%~dp0dist\CineForge\CineForge.exe"
