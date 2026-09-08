@echo off
REM Meduza V - double-click installer for Windows, no Docker required.
REM
REM Windows blocks .ps1 scripts by default, so this wrapper launches the real
REM installer with an execution-policy bypass scoped to this one process. It
REM does not change any machine setting.
REM
REM This is the demo / single-machine path: Python + SQLite, payments
REM simulated. For a real shop use install.bat (Docker + PostgreSQL).

setlocal
title Meduza V - local install

echo.
echo  Meduza V - installing locally (no Docker)...
echo.

REM Prefer PowerShell 7 when it is present; fall back to Windows PowerShell 5.
where pwsh >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-local.ps1" %*
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-local.ps1" %*
)
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% NEQ 0 (
    echo.
    echo  Installation did not complete. See the messages above.
    echo.
)

echo.
pause
exit /b %EXITCODE%
