param(
  [Parameter(Mandatory = $false)]
  [string]$Thumbprint,

  [Parameter(Mandatory = $false)]
  [string]$TimestampUrl = "http://timestamp.digicert.com",

  [Parameter(Mandatory = $false)]
  [string]$SignToolPath,

  [Parameter(Mandatory = $false)]
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$SignScript = Join-Path $PSScriptRoot "sign-win.ps1"
$VerifyScript = Join-Path $PSScriptRoot "verify-win-signatures.ps1"
$DistDir = Join-Path $RepoRoot "dist-electron"
$PrepackagedDir = Join-Path $DistDir "win-unpacked"

function Fail([string]$Message) {
  Write-Error $Message
  exit 1
}

function Invoke-External {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  if ($DryRun) {
    Write-Host "[DRY-RUN] $FilePath $($Arguments -join ' ')"
    return
  }

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "Command failed with exit code $LASTEXITCODE`: $FilePath $($Arguments -join ' ')"
  }
}

function Assert-WorkspaceChildPath([string]$PathValue, [string]$ExpectedName) {
  $fullPath = [System.IO.Path]::GetFullPath($PathValue)
  $rootPath = [System.IO.Path]::GetFullPath($RepoRoot)
  if (-not $fullPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail "Refusing to operate outside the repository: $fullPath"
  }

  if ([System.IO.Path]::GetFileName($fullPath) -ne $ExpectedName) {
    Fail "Refusing to clean unexpected path: $fullPath"
  }

  return $fullPath
}

function Clear-ReleaseOutput {
  $safeDistDir = Assert-WorkspaceChildPath $DistDir "dist-electron"
  if (Test-Path -LiteralPath $safeDistDir) {
    Write-Host "Cleaning release output: $safeDistDir"
    Remove-Item -LiteralPath $safeDistDir -Recurse -Force
  }
}

if (-not $DryRun -and [string]::IsNullOrWhiteSpace($Thumbprint)) {
  Fail "Certificate thumbprint is required for a real Windows release build. Pass -Thumbprint."
}

if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
  Fail "Timestamp URL is required."
}

Write-Host "TalkSync Windows release build"
Write-Host "Repo: $RepoRoot"
Write-Host "Timestamp URL: $TimestampUrl"
Write-Host "Mode: $(if ($DryRun) { 'dry-run' } else { 'real build/sign/verify' })"
Write-Host ""
Write-Host "Important: electron-builder's custom Windows signer signs the app, NSIS helper,"
Write-Host "generated uninstaller, and installer during the NSIS build flow."
Write-Host ""

Push-Location $RepoRoot
try {
  if ($DryRun) {
    Write-Host "[DRY-RUN] would clean release output: $DistDir"
  } else {
    Clear-ReleaseOutput
  }

  Invoke-External "npm" @("run", "build:app")

  if ($DryRun) {
    Write-Host "[DRY-RUN] would set TALKSYNC_WIN_CERT_THUMBPRINT for electron-builder custom signing"
    Write-Host "[DRY-RUN] would set TALKSYNC_WIN_TIMESTAMP_URL=$TimestampUrl"
    Write-Host "[DRY-RUN] npx electron-builder --win --publish never"
  } else {
    $env:TALKSYNC_WIN_CERT_THUMBPRINT = $Thumbprint
    $env:TALKSYNC_WIN_TIMESTAMP_URL = $TimestampUrl
    if (-not [string]::IsNullOrWhiteSpace($SignToolPath)) {
      $env:TALKSYNC_SIGNTOOL_PATH = $SignToolPath
    }

    Invoke-External "npx" @(
      "electron-builder",
      "--win",
      "--publish",
      "never"
    )
  }

  if ($DryRun) {
    Write-Host "[DRY-RUN] would run scripts/verify-win-signatures.ps1"
    return
  }

  Invoke-External "powershell" @(
    "-ExecutionPolicy", "Bypass",
    "-File", $VerifyScript,
    "-DistDir", $DistDir
  )
} finally {
  Pop-Location
}
