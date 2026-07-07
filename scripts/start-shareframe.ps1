param(
  [string]$DataRoot = $(if ($env:OPENCAST_DATA_ROOT) { $env:OPENCAST_DATA_ROOT } else { 'D:\open-source\opencast-data' }),
  [int]$Port = $(if ($env:OPENCAST_PORT) { [int]$env:OPENCAST_PORT } else { 4174 }),
  [string]$HostAddress = $(if ($env:OPENCAST_HOST) { $env:OPENCAST_HOST } else { '127.0.0.1' }),
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$NoBrowser,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-DDrivePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $resolved = [System.IO.Path]::GetFullPath($PathValue)

  if (-not $resolved.StartsWith('D:\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label must stay on D:\. Got $resolved"
  }

  return $resolved.TrimEnd('\')
}

function Ensure-Directory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue
  )

  New-Item -ItemType Directory -Force -Path $PathValue | Out-Null
}

function Invoke-Npm {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & npm.cmd @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "npm.cmd $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Write-LauncherHeader {
  Write-Host ''
  Write-Host 'ShareFrame local launcher'
  Write-Host 'No account required. Recordings stay on this machine.'
}

function Write-LaunchSummary {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DataRootValue,
    [Parameter(Mandatory = $true)]
    [string]$AppUrlValue,
    [Parameter(Mandatory = $true)]
    [string]$TempRootValue,
    [Parameter(Mandatory = $true)]
    [string]$NpmCacheValue
  )

  Write-Host "ShareFrame storage: $DataRootValue"
  Write-Host "ShareFrame app:     $AppUrlValue"
  Write-Host "ShareFrame temp:    $TempRootValue"
  Write-Host "ShareFrame cache:   $NpmCacheValue"
  Write-Host 'ShareFrame access:  Private until you create a guest link'
}

function Test-PortFree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$HostValue,
    [Parameter(Mandatory = $true)]
    [int]$PortValue
  )

  $address = [System.Net.IPAddress]::Parse($HostValue)
  $listener = [System.Net.Sockets.TcpListener]::new($address, $PortValue)

  try {
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    $listener.Stop()
  }
}

function Resolve-FreePort {
  param(
    [Parameter(Mandatory = $true)]
    [string]$HostValue,
    [Parameter(Mandatory = $true)]
    [int]$PreferredPort
  )

  for ($offset = 0; $offset -le 20; $offset += 1) {
    $candidate = $PreferredPort + $offset

    if (Test-PortFree -HostValue $HostValue -PortValue $candidate) {
      return $candidate
    }
  }

  throw "No free local port found from $PreferredPort to $($PreferredPort + 20)."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'npm.cmd was not found. Install Node.js before starting ShareFrame.'
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$workspaceRoot = Split-Path -Parent $repoRoot
$resolvedDataRoot = Resolve-DDrivePath -PathValue $DataRoot -Label 'OPENCAST_DATA_ROOT'
$tempRoot = Resolve-DDrivePath -PathValue (Join-Path $workspaceRoot '.temp') -Label 'TEMP'
$npmCache = Resolve-DDrivePath -PathValue (Join-Path $workspaceRoot '.cache\npm') -Label 'npm_config_cache'
$corepackHome = Resolve-DDrivePath -PathValue (Join-Path $workspaceRoot '.cache\corepack') -Label 'COREPACK_HOME'
$pnpmHome = Resolve-DDrivePath -PathValue (Join-Path $workspaceRoot '.cache\pnpm-home') -Label 'PNPM_HOME'

Ensure-Directory -PathValue $resolvedDataRoot
Ensure-Directory -PathValue $tempRoot
Ensure-Directory -PathValue $npmCache
Ensure-Directory -PathValue $corepackHome
Ensure-Directory -PathValue $pnpmHome

Set-Location $repoRoot

$selectedPort = Resolve-FreePort -HostValue $HostAddress -PreferredPort $Port
if ($selectedPort -ne $Port) {
  Write-Host "Port $Port is busy. ShareFrame will use $selectedPort instead."
}

$env:TEMP = $tempRoot
$env:TMP = $tempRoot
$env:npm_config_cache = $npmCache
$env:COREPACK_HOME = $corepackHome
$env:PNPM_HOME = $pnpmHome
$env:OPENCAST_HOST = $HostAddress
$env:OPENCAST_PORT = [string]$selectedPort
$env:OPENCAST_DATA_ROOT = $resolvedDataRoot

$appUrl = "http://$HostAddress`:$selectedPort/"
if ($DryRun) {
  Write-LauncherHeader
  Write-LaunchSummary -DataRootValue $resolvedDataRoot -AppUrlValue $appUrl -TempRootValue $tempRoot -NpmCacheValue $npmCache
  Write-Host 'Dry run complete. No install, build, browser, or server start was run.'
  exit 0
}

Write-LauncherHeader

if (-not $SkipInstall -and -not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
  Write-Host 'Installing ShareFrame dependencies...'
  Invoke-Npm -Arguments @('install')
}

$webIndex = Join-Path $repoRoot 'dist\index.html'
if ($SkipBuild -and -not (Test-Path $webIndex)) {
  throw 'Web build is missing. Run npm.cmd run build or omit -SkipBuild.'
}

if (-not $SkipBuild) {
  Write-Host 'Building ShareFrame web app...'
  Invoke-Npm -Arguments @('run', 'build')
}

Write-LaunchSummary -DataRootValue $resolvedDataRoot -AppUrlValue $appUrl -TempRootValue $tempRoot -NpmCacheValue $npmCache
Write-Host 'Stop ShareFrame with Ctrl+C or by closing this window.'
Write-Host ''

if (-not $NoBrowser) {
  Write-Host 'Opening ShareFrame in your browser...'
  Start-Process $appUrl
} else {
  Write-Host 'Browser launch skipped. Open the ShareFrame app URL above when ready.'
}

Invoke-Npm -Arguments @('run', 'start:local')
