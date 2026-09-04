#Requires -Version 5.1
<#
.SYNOPSIS
    Meduza V - remove the local installation.

.DESCRIPTION
    By default this stops and removes the containers but KEEPS your data and
    configuration, so re-running install.ps1 brings the same shop back.
    Use -Purge to also delete the database and .env.
#>
[CmdletBinding()]
param([switch]$Purge)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if ($Purge) {
    Write-Host ''
    Write-Host 'This permanently deletes the database (all orders and products).' -ForegroundColor Yellow
    Write-Host 'Backups in .\backups are kept.'
    $reply = Read-Host 'Type DELETE to confirm'
    if ($reply -cne 'DELETE') { Write-Host 'Cancelled.'; exit 1 }
    & docker compose down --volumes --remove-orphans
    Remove-Item -Path '.env' -ErrorAction SilentlyContinue
    Write-Host 'Removed containers, database volume and .env.' -ForegroundColor Green
} else {
    & docker compose down --remove-orphans
    Write-Host 'Removed containers. Data and .env are kept; run install.ps1 to start again.' -ForegroundColor Green
}
