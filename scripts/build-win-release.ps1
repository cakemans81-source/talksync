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

function Get-RequiredFile([string]$PathValue, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    Fail "$Label not found: $PathValue"
  }

  return (Resolve-Path -LiteralPath $PathValue).Path
}

function Invoke-SignScript {
  param(
    [string[]]$Targets
  )

  if (-not [string]::IsNullOrWhiteSpace($SignToolPath)) {
    & $SignScript -Thumbprint $Thumbprint -TimestampUrl $TimestampUrl -SignToolPath $SignToolPath -Files $Targets
  } else {
    & $SignScript -Thumbprint $Thumbprint -TimestampUrl $TimestampUrl -Files $Targets
  }

  if ($LASTEXITCODE -ne 0) {
    Fail "Signing script failed with exit code $LASTEXITCODE."
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
Write-Host "Important: this script signs the prepackaged app before generating the NSIS installer."
Write-Host "The installer is signed after generation. If runtime auto-updates are enabled later,"
Write-Host "ensure latest.yml hashes are generated after final signing or move signing into electron-builder hooks."
Write-Host ""

Push-Location $RepoRoot
try {
  Invoke-External "npm" @("run", "build:app")

  Invoke-External "npx" @(
    "electron-builder",
    "--win",
    "--dir",
    "--publish",
    "never"
  )

  $appExe = Join-Path $PrepackagedDir "TalkSync.exe"
  $elevateExe = Join-Path $PrepackagedDir "resources\elevate.exe"

  if ($DryRun) {
    Write-Host "[DRY-RUN] would require app exe: $appExe"
    Write-Host "[DRY-RUN] would require helper exe: $elevateExe"
    Write-Host "[DRY-RUN] would sign prepackaged executables with scripts/sign-win.ps1"
  } else {
    $prepackagedTargets = @(
      (Get-RequiredFile $appExe "app exe"),
      (Get-RequiredFile $elevateExe "helper exe")
    )

    Invoke-SignScript $prepackagedTargets
  }

  Invoke-External "npx" @(
    "electron-builder",
    "--win",
    "--prepackaged",
    $PrepackagedDir,
    "--publish",
    "never"
  )

  if ($DryRun) {
    Write-Host "[DRY-RUN] would sign installer(s): dist-electron\TalkSync-Setup*.exe"
    Write-Host "[DRY-RUN] would run scripts/verify-win-signatures.ps1"
    return
  }

  $installers = @(Get-ChildItem -LiteralPath $DistDir -File -Filter "TalkSync-Setup*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending)
  if ($installers.Count -eq 0) {
    Fail "No TalkSync NSIS installer was generated under $DistDir."
  }

  $installerTargets = @($installers | ForEach-Object { $_.FullName })
  Invoke-SignScript $installerTargets
  Invoke-External "powershell" @(
    "-ExecutionPolicy", "Bypass",
    "-File", $VerifyScript,
    "-DistDir", $DistDir
  )
} finally {
  Pop-Location
}
