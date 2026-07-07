param(
  [Parameter(Mandatory = $false)]
  [string]$Thumbprint,

  [Parameter(Mandatory = $false)]
  [string]$TimestampUrl = "http://timestamp.digicert.com",

  [Parameter(Mandatory = $false)]
  [string]$SignToolPath,

  [Parameter(Mandatory = $false)]
  [switch]$DryRun,

  [Parameter(Mandatory = $true)]
  [string[]]$Files
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

function Fail([string]$Message) {
  Write-Error $Message
  exit 1
}

function Normalize-Thumbprint([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    Fail "Certificate thumbprint is required. Pass -Thumbprint or provide it through your release wrapper."
  }

  $normalized = ($Value -replace "\s", "").ToUpperInvariant()
  if ($normalized -notmatch "^[0-9A-F]{40}$") {
    Fail "Certificate thumbprint must be a 40-character SHA-1 hex string. Do not include a PIN or secret."
  }

  return $normalized
}

function Resolve-TargetPath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    $candidate = $PathValue
  } else {
    $candidate = Join-Path $RepoRoot $PathValue
  }

  if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
    Fail "Signing target not found: $PathValue"
  }

  return (Resolve-Path -LiteralPath $candidate).Path
}

function Find-SignTool {
  param([string]$RequestedPath)

  if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
    if (-not (Test-Path -LiteralPath $RequestedPath -PathType Leaf)) {
      Fail "signtool.exe was not found at -SignToolPath: $RequestedPath"
    }
    return (Resolve-Path -LiteralPath $RequestedPath).Path
  }

  $candidatePatterns = @()
  if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
    $candidatePatterns += (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin\*\x64\signtool.exe")
    $candidatePatterns += (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin\*\x86\signtool.exe")
  }
  if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
    $candidatePatterns += (Join-Path $env:ProgramFiles "Windows Kits\10\bin\*\x64\signtool.exe")
    $candidatePatterns += (Join-Path $env:ProgramFiles "Windows Kits\10\bin\*\x86\signtool.exe")
  }

  $found = @()
  foreach ($pattern in $candidatePatterns) {
    $found += @(Resolve-Path -Path $pattern -ErrorAction SilentlyContinue | ForEach-Object { $_.Path })
  }

  $command = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    $found += $command.Source
  }

  $selected = $found |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Sort-Object `
      @{ Expression = { if ($_ -match "\\x64\\signtool\.exe$") { 1 } else { 0 } }; Descending = $true },
      @{ Expression = { $_ }; Descending = $true } |
    Select-Object -First 1

  if ([string]::IsNullOrWhiteSpace($selected)) {
    if ($DryRun) {
      Write-Warning "signtool.exe was not found. Dry-run will print commands with the placeholder <signtool.exe>."
      return "<signtool.exe>"
    }

    Fail "signtool.exe was not found. Install Windows SDK or pass -SignToolPath."
  }

  return $selected
}

function Test-SignedFile([string]$PathValue) {
  $signature = Get-AuthenticodeSignature -FilePath $PathValue
  if ($signature.Status -ne "Valid") {
    Fail "Signature verification failed for $PathValue. Status: $($signature.Status). $($signature.StatusMessage)"
  }

  Write-Host "PASS signature valid: $PathValue"
}

$thumbprintValue = Normalize-Thumbprint $Thumbprint
if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
  Fail "Timestamp URL is required."
}

$signTool = Find-SignTool $SignToolPath
$expandedFiles = @()
foreach ($fileValue in $Files) {
  if ($fileValue -like "*,*") {
    $expandedFiles += @($fileValue -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  } else {
    $expandedFiles += $fileValue
  }
}

$targetPaths = @($expandedFiles | ForEach-Object { Resolve-TargetPath $_ } | Sort-Object -Unique)
if ($targetPaths.Count -eq 0) {
  Fail "No signing targets were provided."
}

Write-Host "TalkSync Windows signing"
Write-Host "Timestamp URL: $TimestampUrl"
Write-Host "signtool: $signTool"
Write-Host "Targets: $($targetPaths.Count)"

foreach ($target in $targetPaths) {
  $args = @(
    "sign",
    "/sha1", $thumbprintValue,
    "/fd", "SHA256",
    "/tr", $TimestampUrl,
    "/td", "SHA256",
    "/v",
    $target
  )

  if ($DryRun) {
    Write-Host "[DRY-RUN] $signTool $($args -join ' ')"
    continue
  }

  Write-Host "Signing: $target"
  & $signTool @args
  if ($LASTEXITCODE -ne 0) {
    Fail "signtool sign failed for $target with exit code $LASTEXITCODE."
  }

  Test-SignedFile $target
}

if ($DryRun) {
  Write-Host "DRY-RUN complete. No files were signed."
} else {
  Write-Host "Signing complete."
}
