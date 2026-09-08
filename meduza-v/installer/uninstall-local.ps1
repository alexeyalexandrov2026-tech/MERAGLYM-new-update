# Meduza V - remove the local (no-Docker) install.
#
#   .\installer\uninstall-local.ps1           stop it, keep your data
#   .\installer\uninstall-local.ps1 -Purge    also delete the database and .env
#
# Without -Purge this leaves meduza-local.db and .env alone, so re-running
# install-local.ps1 brings the same shop back with the same orders.

[CmdletBinding()]
param([switch]$Purge)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$OnWindows = $IsWindows -or ($PSVersionTable.PSVersion.Major -le 5)

function Get-ChildPids([int]$ParentId) {
    # The installer records the shell it launched, and that shell stays alive as
    # the parent of the actual Python process because it owns the redirection.
    # Killing only the recorded PID would leave the shop running.
    if ($OnWindows) {
        if (-not (Get-Command Get-CimInstance -ErrorAction SilentlyContinue)) { return @() }
        return @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentId" -ErrorAction SilentlyContinue |
                 ForEach-Object { $_.ProcessId })
    }
    # CIM/WMI does not exist off Windows; pgrep is in every base install there.
    $out = & pgrep -P $ParentId 2>$null
    if (-not $out) { return @() }
    return @($out | ForEach-Object { [int]$_ })
}

function Step($m) { Write-Host "==> $m" -ForegroundColor White }
function Ok($m)   { Write-Host "    + $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    ! $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Meduza V - removing the local install" -ForegroundColor White
Write-Host ""

Step 'Stopping the shop'
# Stop exactly what the installer started, by the PIDs it recorded. Matching on
# the process path instead would miss them on Linux and macOS, where
# .venv/bin/python is a symlink and the reported path is the system
# interpreter, outside the project entirely.
$pidFile = Join-Path $ProjectRoot '.meduza-local.pid'
$stopped = 0
if (Test-Path $pidFile) {
    foreach ($line in Get-Content $pidFile) {
        if (-not ($line -match '^\s*(\d+)\s*$')) { continue }
        $procId = [int]$Matches[1]
        # A PID file can outlive its processes and the number can be reused, so
        # stop the recorded process together with the children it spawned, and
        # ignore anything that is already gone.
        foreach ($child in (Get-ChildPids $procId)) {
            Stop-Process -Id $child -Force -ErrorAction SilentlyContinue
            $stopped++
        }
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            $stopped++
        }
    }
    Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
}
if ($stopped -gt 0) { Ok "stopped $stopped process(es)" }
else { Warn 'nothing was running (or it was started by hand — stop it yourself)' }

Step 'Removing generated files'
foreach ($f in @('.venv', 'start-local.ps1', 'start-local.sh', 'server.log', 'worker.log', '.meduza-local.pid')) {
    if (Test-Path $f) { Remove-Item -Recurse -Force $f; Ok "removed $f" }
}

if ($Purge) {
    Step 'Purging data and configuration'
    foreach ($f in @('meduza-local.db', 'meduza-local.db-wal', 'meduza-local.db-shm', '.env')) {
        if (Test-Path $f) { Remove-Item -Force $f; Ok "deleted $f" }
    }
    Write-Host ""
    Write-Host "Removed, including your orders and configuration." -ForegroundColor Green
    Write-Host ""
} else {
    Step 'Keeping your data'
    if (Test-Path 'meduza-local.db') { Ok 'kept meduza-local.db (your orders)' }
    if (Test-Path '.env') { Ok 'kept .env (your admin key and settings)' }
    Warn 'add -Purge to delete these as well'
    Write-Host ""
    Write-Host "Removed. Re-run installer\install-local.ps1 to bring it back." -ForegroundColor Green
    Write-Host ""
}
