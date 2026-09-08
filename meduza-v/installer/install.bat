@echo off
REM Meduza V - double-click installer for Windows.
REM
REM Windows blocks .ps1 scripts by default, so this wrapper launches the real
REM installer with an execution-policy bypass scoped to this one process. It
REM does not change any machine setting.

setlocal
title Meduza V installer

echo.
echo  Meduza V - installing...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set EXITCODE=%ERRORLEVEL%

if %EXITCODE% NEQ 0 (
    echo.
    echo  Installation did not complete. See the messages above.
    echo.
)

echo.
pause
exit /b %EXITCODE%
