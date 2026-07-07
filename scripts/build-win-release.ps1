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

function Add-UniqueTarget {
  param(
    [System.Collections.Generic.List[string]]$Targets,
    [string]$PathValue
  )

  $resolved = (Resolve-Path -LiteralPath $PathValue).Path
  if (-not $Targets.Contains($resolved)) {
    $Targets.Add($resolved)
  }
}

function Get-PrepackagedExeTargets {
  $targets = [System.Collections.Generic.List[string]]::new()
  $appExe = Join-Path $PrepackagedDir "TalkSync.exe"
  $elevateExe = Join-Path $PrepackagedDir "resources\elevate.exe"

  Add-UniqueTarget -Targets $targets -PathValue (Get-RequiredFile $appExe "app exe")

  if (Test-Path -LiteralPath $elevateExe -PathType Leaf) {
    Add-UniqueTarget -Targets $targets -PathValue $elevateExe
  } else {
    Write-Host "WARN optional helper exe not found: $elevateExe" -ForegroundColor Yellow
  }

  $allExes = @(Get-ChildItem -LiteralPath $PrepackagedDir -Recurse -File -Filter "*.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName)
  foreach ($exe in $allExes) {
    Add-UniqueTarget -Targets $targets -PathValue $exe.FullName
  }

  return $targets.ToArray()
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
  if ($DryRun) {
    Write-Host "[DRY-RUN] would clean release output: $DistDir"
  } else {
    Clear-ReleaseOutput
  }

  Invoke-External "npm" @("run", "build:app")

  Invoke-External "npx" @(
    "electron-builder",
    "--win",
    "--dir",
    "--publish",
    "never"
  )

  if ($DryRun) {
    Write-Host "[DRY-RUN] would require app exe: $(Join-Path $PrepackagedDir "TalkSync.exe")"
    Write-Host "[DRY-RUN] would sign every .exe found under: $PrepackagedDir"
    Write-Host "[DRY-RUN] would warn, not fail, if optional helper is missing: $(Join-Path $PrepackagedDir "resources\elevate.exe")"
  } else {
    $prepackagedTargets = @(Get-PrepackagedExeTargets)
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
