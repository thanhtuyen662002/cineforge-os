@echo off
setlocal
rem Double-click this file to open the verified one-file CineForge.exe.
rem The single-file directory intentionally contains only the executable: its
rem web/Core/Node payload is authenticated and extracted to a per-user cache at
rem runtime. Explicit command-line arguments retain the lower-level build path.
if "%~1"=="" if exist "%~dp0dist\CineForge-OneFile\CineForge.exe" (
    start "CineForge" "%~dp0dist\CineForge-OneFile\CineForge.exe"
    exit /b 0
)
if not "%~1"=="" (
    call "%~dp0packaging\build_windows.cmd" %*
    exit /b %ERRORLEVEL%
)
call "%~dp0packaging\build_windows.cmd" -Mode SingleFile
if errorlevel 1 exit /b %ERRORLEVEL%
start "CineForge" "%~dp0dist\CineForge-OneFile\CineForge.exe"
