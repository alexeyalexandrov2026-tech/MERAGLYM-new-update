#Requires -Version 5.1
<#
.SYNOPSIS
    Meduza V - one-command installer for Windows.

.DESCRIPTION
    Brings up the whole stack (PostgreSQL, Redis, web, worker, backups) with
    Docker Desktop, generates the secrets a first run needs, applies migrations,
    loads the sample catalog and waits until the service answers its own health
    check.

    Safe to re-run: an existing .env is never overwritten, and the catalog seed
    is idempotent.

.PARAMETER Rebuild
    Force a clean image rebuild and container recreation.

.PARAMETER NoSeed
    Skip loading the sample catalog.

.PARAMETER NoBrowser
    Do not open the browser when the install finishes.

.EXAMPLE
    .\install.ps1

.EXAMPLE
    .\install.ps1 -Rebuild -NoBrowser
#>
[CmdletBinding()]
param(
    [switch]$Rebuild,
    [switch]$NoSeed,
    [switch]$NoBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AppName        = 'Meduza V'
$AppUrl         = 'http://localhost:8000'
$HealthTimeout  = 180
$ProjectRoot    = Split-Path -Parent $PSScriptRoot

function Write-Step { param([string]$Text) Write-Host "==> $Text" -ForegroundColor White }
function Write-Ok   { param([string]$Text) Write-Host "    + $Text" -ForegroundColor Green }
function Write-Warn { param([string]$Text) Write-Host "    ! $Text" -ForegroundColor Yellow }
function Write-Dim  { param([string]$Text) Write-Host $Text -ForegroundColor DarkGray }

function Stop-WithError {
    param([string]$Message)
    Write-Host ''
    Write-Host "error: $Message" -ForegroundColor Red
    Write-Host ''
    # Keep the window open when launched by double-click, so the message is readable.
    if ($Host.Name -eq 'ConsoleHost' -and [Environment]::UserInteractive) {
        Write-Host 'Press any key to close...' -ForegroundColor DarkGray
        try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { }
    }
    exit 1
}

# 36 random bytes -> 48 URL-safe characters, comfortably over the 32-character
# minimum config.py enforces. Uses the cryptographic RNG, not Get-Random.
function New-Secret {
    param([int]$ByteCount = 36)
    $buffer = New-Object 'byte[]' $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    [Convert]::ToBase64String($buffer).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

# Docker Compose reads .env byte-for-byte. A UTF-8 BOM corrupts the first
# variable name and CRLF leaves a stray carriage return inside every value, so
# the file is always written as BOM-free UTF-8 with LF endings.
function Write-EnvFile {
    param([string]$Path, [string[]]$Lines)
    $text = ($Lines -join "`n") + "`n"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $text, $utf8NoBom)
}

function Set-EnvValue {
    param([string[]]$Lines, [string]$Key, [string]$Value)
    $found = $false
    $result = foreach ($line in $Lines) {
        if (-not $found -and $line -match "^$([regex]::Escape($Key))=") {
            $found = $true
            "$Key=$Value"
        } else {
            $line
        }
    }
    if (-not $found) { $result = @($result) + "$Key=$Value" }
    , @($result)
}

function Invoke-Docker {
    param([string[]]$Arguments)
    # Compose writes progress to stderr; merge it so it does not look like a failure.
    & docker @Arguments 2>&1 | ForEach-Object { Write-Dim "    $_" }
    return $LASTEXITCODE
}

Set-Location $ProjectRoot
Write-Host ''
Write-Host "$AppName installer" -ForegroundColor Cyan
Write-Dim $ProjectRoot
Write-Host ''

# ---------------------------------------------------------------------------
Write-Step 'Checking prerequisites'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Stop-WithError @"
Docker Desktop is not installed.

    Download and install it, then run this installer again:
    https://www.docker.com/products/docker-desktop/

    Docker Desktop runs the database, cache, web service and worker for you.
"@
}
& docker compose version *>$null
if ($LASTEXITCODE -ne 0) {
    Stop-WithError @"
Docker Compose v2 is not available.

    Update Docker Desktop to a current version:
    https://www.docker.com/products/docker-desktop/
"@
}
& docker info *>$null
if ($LASTEXITCODE -ne 0) {
    Stop-WithError @"
Docker Desktop is installed but not running.

    Start Docker Desktop, wait for the whale icon to stop animating,
    then run this installer again.
"@
}
$dockerVersion = (& docker version --format '{{.Server.Version}}' 2>$null)
$composeVersion = (& docker compose version --short 2>$null)
Write-Ok "docker $dockerVersion"
Write-Ok "docker compose $composeVersion"

# ---------------------------------------------------------------------------
Write-Step 'Preparing configuration'
$envPath = Join-Path $ProjectRoot '.env'
$envExamplePath = Join-Path $ProjectRoot '.env.example'

if (Test-Path $envPath) {
    # Never clobber real credentials the operator has already configured.
    Write-Ok '.env already exists - leaving it untouched'
} else {
    if (-not (Test-Path $envExamplePath)) {
        Stop-WithError '.env.example is missing; is the project complete?'
    }
    $lines = [System.IO.File]::ReadAllLines($envExamplePath)

    $adminKey = New-Secret
    $dbPassword = New-Secret
    $lines = Set-EnvValue -Lines $lines -Key 'ADMIN_API_KEY'     -Value $adminKey
    $lines = Set-EnvValue -Lines $lines -Key 'POSTGRES_PASSWORD' -Value $dbPassword
    # DATABASE_URL carries its own copy of the password; keep the two in step.
    $lines = Set-EnvValue -Lines $lines -Key 'DATABASE_URL' `
                          -Value "postgresql+asyncpg://meduza:$dbPassword@db:5432/meduza"
    # Start in offline demo mode so the very first run works with no accounts:
    # no Stripe keys needed, receipts printed to the log instead of emailed.
    $lines = Set-EnvValue -Lines $lines -Key 'PAYMENT_PROVIDER' -Value 'fake'
    $lines = Set-EnvValue -Lines $lines -Key 'EMAIL_BACKEND'    -Value 'console'
    $lines = Set-EnvValue -Lines $lines -Key 'EMAIL_FROM_NAME'  -Value $AppName

    Write-EnvFile -Path $envPath -Lines $lines
    Write-Ok 'generated .env with fresh admin and database secrets'
    Write-Warn 'demo mode: payments are simulated, receipts go to the log'
}

$backupsDir = Join-Path $ProjectRoot 'backups'
if (-not (Test-Path $backupsDir)) { New-Item -ItemType Directory -Path $backupsDir | Out-Null }

# ---------------------------------------------------------------------------
Write-Step 'Building and starting the stack (first run pulls images - a few minutes)'
$composeArgs = @('compose', 'up', '-d', '--build')
if ($Rebuild) { $composeArgs += '--force-recreate' }
if ((Invoke-Docker -Arguments $composeArgs) -ne 0) {
    Stop-WithError 'docker compose failed to start the stack. Scroll up for the reason.'
}
Write-Ok 'containers are up'

# ---------------------------------------------------------------------------
Write-Step 'Waiting for the service to become healthy'
$deadline = (Get-Date).AddSeconds($HealthTimeout)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -Uri "$AppUrl/healthz" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $healthy) {
    Write-Host ''
    Write-Dim '--- recent logs ---'
    & docker compose logs --tail 40 web migrate 2>&1 | ForEach-Object { Write-Dim "    $_" }
    Stop-WithError "the service did not become healthy within $HealthTimeout seconds (logs above)"
}
Write-Ok 'health check passed'
try {
    $ready = Invoke-WebRequest -Uri "$AppUrl/readyz" -UseBasicParsing -TimeoutSec 5
    if ($ready.StatusCode -eq 200) {
        Write-Ok 'readiness check passed (database reachable, provider configured)'
    }
} catch {
    Write-Warn 'readiness check is failing - see: docker compose logs web'
}

# ---------------------------------------------------------------------------
if (-not $NoSeed) {
    Write-Step 'Loading the sample catalog'
    & docker compose exec -T web python -m app.seed *>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok 'catalog ready (re-running this installer will not duplicate it)'
    } else {
        Write-Warn 'seeding failed; the app is still running. Retry: docker compose exec web python -m app.seed'
    }
}

# ---------------------------------------------------------------------------
$adminKeyValue = (Select-String -Path $envPath -Pattern '^ADMIN_API_KEY=' |
                  Select-Object -First 1).Line -replace '^ADMIN_API_KEY=', ''

Write-Host ''
Write-Host "$AppName is running." -ForegroundColor Green
Write-Host ''
Write-Host "  Storefront API   $AppUrl"
Write-Host "  API docs         $AppUrl/docs"
Write-Host "  Health           $AppUrl/healthz"
Write-Host "  Metrics          $AppUrl/metrics"
Write-Host ''
Write-Host "  Admin API key    $adminKeyValue"
Write-Dim  '  (also in .env - treat it like a password)'
Write-Host ''
Write-Host '  Manage:'
Write-Host '    docker compose logs -f web worker     follow the logs'
Write-Host '    docker compose ps                     service status'
Write-Host '    docker compose stop                   stop (data is kept)'
Write-Host '    .\installer\uninstall.ps1             remove containers'
Write-Host ''
Write-Host 'Before taking real payments' -ForegroundColor Yellow -NoNewline
Write-Host ', edit .env: set PAYMENT_PROVIDER=stripe with your'
Write-Host 'Stripe keys, EMAIL_BACKEND=smtp with your mail credentials, then re-run this'
Write-Host 'installer. See README.md for the full production checklist.'
Write-Host ''

if (-not $NoBrowser) { Start-Process "$AppUrl/docs" }
