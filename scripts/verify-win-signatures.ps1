param(
  [Parameter(Mandatory = $false)]
  [string]$DistDir = "dist-electron",

  [Parameter(Mandatory = $false)]
  [switch]$AllowMissingElevate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$windowsPowerShellModulePaths = @(
  (Join-Path $HOME "Documents\WindowsPowerShell\Modules"),
  (Join-Path $env:ProgramFiles "WindowsPowerShell\Modules"),
  (Join-Path $env:SystemRoot "system32\WindowsPowerShell\v1.0\Modules")
)
$env:PSModulePath = ($windowsPowerShellModulePaths -join [System.IO.Path]::PathSeparator)

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Resolve-RepoPath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }
  return (Join-Path $RepoRoot $PathValue)
}

function Add-RequiredTarget {
  param(
    [System.Collections.Generic.List[string]]$Targets,
    [string]$PathValue,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    Write-Host "FAIL missing $Label`: $PathValue" -ForegroundColor Red
    return $false
  }

  $Targets.Add((Resolve-Path -LiteralPath $PathValue).Path)
  return $true
}

$distPath = Resolve-RepoPath $DistDir
if (-not (Test-Path -LiteralPath $distPath -PathType Container)) {
  Write-Host "FAIL dist directory not found: $distPath" -ForegroundColor Red
  exit 1
}

$targets = [System.Collections.Generic.List[string]]::new()
$missingRequired = $false

$appExe = Join-Path $distPath "win-unpacked\TalkSync.exe"
if (-not (Add-RequiredTarget -Targets $targets -PathValue $appExe -Label "app exe")) {
  $missingRequired = $true
}

$elevateExe = Join-Path $distPath "win-unpacked\resources\elevate.exe"
if (Test-Path -LiteralPath $elevateExe -PathType Leaf) {
  $targets.Add((Resolve-Path -LiteralPath $elevateExe).Path)
} elseif ($AllowMissingElevate) {
  Write-Host "WARN missing helper exe: $elevateExe" -ForegroundColor Yellow
} else {
  Write-Host "FAIL missing helper exe: $elevateExe" -ForegroundColor Red
  $missingRequired = $true
}

$installers = @(Get-ChildItem -LiteralPath $distPath -File -Filter "TalkSync-Setup*.exe" -ErrorAction SilentlyContinue |
  Sort-Object Name)
if ($installers.Count -eq 0) {
  Write-Host "FAIL installer exe not found under $distPath" -ForegroundColor Red
  $missingRequired = $true
} else {
  foreach ($installer in $installers) {
    $targets.Add($installer.FullName)
  }
}

if ($missingRequired) {
  Write-Host "Signature verification failed before signature checks because required release files are missing." -ForegroundColor Red
  exit 1
}

$failures = 0
Write-Host "TalkSync Windows signature verification"
Write-Host "Dist: $distPath"
Write-Host "Targets: $($targets.Count)"

foreach ($target in $targets) {
  $signature = Get-AuthenticodeSignature -FilePath $target
  if ($signature.Status -eq "Valid") {
    Write-Host "PASS $target" -ForegroundColor Green
    continue
  }

  $failures += 1
  Write-Host "FAIL $target" -ForegroundColor Red
  Write-Host "     Status: $($signature.Status)"
  Write-Host "     Message: $($signature.StatusMessage)"
}

if ($failures -gt 0) {
  Write-Host "FAIL summary: $failures of $($targets.Count) target(s) are not validly signed." -ForegroundColor Red
  exit 1
}

Write-Host "PASS summary: all $($targets.Count) target(s) are validly signed." -ForegroundColor Green
