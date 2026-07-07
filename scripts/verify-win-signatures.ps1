param(
  [Parameter(Mandatory = $false)]
  [string]$DistDir = "dist-electron",

  [Parameter(Mandatory = $false)]
  [string]$InstalledDir
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

function Add-Target {
  param(
    [System.Collections.Generic.List[string]]$Targets,
    [string]$PathValue
  )

  $resolved = (Resolve-Path -LiteralPath $PathValue).Path
  if (-not $Targets.Contains($resolved)) {
    $Targets.Add($resolved)
  }
}

$distPath = Resolve-RepoPath $DistDir
if (-not (Test-Path -LiteralPath $distPath -PathType Container)) {
  Write-Host "FAIL dist directory not found: $distPath" -ForegroundColor Red
  exit 1
}

$targets = [System.Collections.Generic.List[string]]::new()
$missingRequired = $false

$appExe = Join-Path $distPath "win-unpacked\TalkSync.exe"
if (Test-Path -LiteralPath $appExe -PathType Leaf) {
  Add-Target -Targets $targets -PathValue $appExe
} else {
  Write-Host "FAIL missing app exe: $appExe" -ForegroundColor Red
  $missingRequired = $true
}

$elevateExe = Join-Path $distPath "win-unpacked\resources\elevate.exe"
if (Test-Path -LiteralPath $elevateExe -PathType Leaf) {
  Add-Target -Targets $targets -PathValue $elevateExe
} else {
  Write-Host "WARN missing helper exe: $elevateExe" -ForegroundColor Yellow
}

$winUnpackedPath = Join-Path $distPath "win-unpacked"
if (Test-Path -LiteralPath $winUnpackedPath -PathType Container) {
  $winUnpackedExes = @(Get-ChildItem -LiteralPath $winUnpackedPath -Recurse -File -Filter "*.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName)
  foreach ($exe in $winUnpackedExes) {
    Add-Target -Targets $targets -PathValue $exe.FullName
  }
}

$installers = @(Get-ChildItem -LiteralPath $distPath -File -Filter "TalkSync-Setup*.exe" -ErrorAction SilentlyContinue |
  Sort-Object Name)
if ($installers.Count -eq 0) {
  Write-Host "FAIL installer exe not found under $distPath" -ForegroundColor Red
  $missingRequired = $true
} else {
  foreach ($installer in $installers) {
    Add-Target -Targets $targets -PathValue $installer.FullName
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

if (-not [string]::IsNullOrWhiteSpace($InstalledDir)) {
  $installedPath = Resolve-RepoPath $InstalledDir
  if (-not (Test-Path -LiteralPath $installedPath -PathType Container)) {
    Write-Host "FAIL installed directory not found: $installedPath" -ForegroundColor Red
    exit 1
  }

  $installedExes = @(Get-ChildItem -LiteralPath $installedPath -Recurse -File -Filter "*.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName)
  if ($installedExes.Count -eq 0) {
    Write-Host "FAIL no installed EXE files found under $installedPath" -ForegroundColor Red
    exit 1
  }

  $installedFailures = 0
  Write-Host "TalkSync installed-path signature verification"
  Write-Host "InstalledDir: $installedPath"
  Write-Host "Targets: $($installedExes.Count)"

  foreach ($exe in $installedExes) {
    $signature = Get-AuthenticodeSignature -FilePath $exe.FullName
    if ($signature.Status -eq "Valid") {
      Write-Host "PASS $($exe.FullName)" -ForegroundColor Green
      continue
    }

    $installedFailures += 1
    Write-Host "FAIL $($exe.FullName)" -ForegroundColor Red
    Write-Host "     Status: $($signature.Status)"
    Write-Host "     Message: $($signature.StatusMessage)"
  }

  if ($installedFailures -gt 0) {
    Write-Host "FAIL installed summary: $installedFailures of $($installedExes.Count) target(s) are not validly signed." -ForegroundColor Red
    exit 1
  }

  Write-Host "PASS installed summary: all $($installedExes.Count) target(s) are validly signed." -ForegroundColor Green
}
