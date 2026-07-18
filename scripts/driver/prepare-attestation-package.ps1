<#
.SYNOPSIS
  Copy only the TalkSync driver attestation submit triple and write a SHA256 manifest.

.DESCRIPTION
  Safe prep helper for Hardware Dev Center attestation packaging.
  Copies ONLY:
    - ComponentizedAudioSample.inf
    - TabletAudioSample.sys
    - talksync.cat
  Writes package_manifest.json with SHA256 digests.

  Does NOT: EV-sign, enter PIN, install drivers, run pnputil/devcon,
  call HDC, or modify app product code.

.PARAMETER SourcePackageDir
  Directory containing build or prior staging artifacts (e.g. x64\Release\package).

.PARAMETER DestDir
  Destination folder for the filtered package (created if missing).

.EXAMPLE
  pwsh -File scripts/driver/prepare-attestation-package.ps1 `
    -SourcePackageDir "C:\Users\user\Desktop\TalkSync_Driver\Windows-driver-samples\audio\sysvad\x64\Release\package" `
    -DestDir "C:\Users\user\Desktop\TalkSync_Driver\package_attestation_ready_20260718"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourcePackageDir,

  [Parameter(Mandatory = $true)]
  [string]$DestDir
)

$ErrorActionPreference = "Stop"

$required = @(
  "ComponentizedAudioSample.inf",
  "TabletAudioSample.sys",
  "talksync.cat"
)

$prohibited = @(
  "ComponentizedAudioSampleExtension.inf",
  "ComponentizedApoSample.inf",
  "sysvad.cat"
)

if (-not (Test-Path -LiteralPath $SourcePackageDir)) {
  throw "SourcePackageDir not found: $SourcePackageDir"
}

# Resolve early so same-dir detection is reliable (M1)
$SourcePackageDir = (Resolve-Path -LiteralPath $SourcePackageDir).Path
if (-not (Test-Path -LiteralPath $DestDir)) {
  New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
}
$DestDir = (Resolve-Path -LiteralPath $DestDir).Path
$sameDir = [string]::Equals($SourcePackageDir, $DestDir, [System.StringComparison]::OrdinalIgnoreCase)

foreach ($name in $required) {
  $p = Join-Path $SourcePackageDir $name
  if (-not (Test-Path -LiteralPath $p)) {
    throw "Missing required file in source: $name"
  }
}

# M2: refuse contaminated *source* (e.g. x64\Debug\package with Extension/sysvad.cat)
foreach ($name in $prohibited) {
  $p = Join-Path $SourcePackageDir $name
  if (Test-Path -LiteralPath $p) {
    throw "Prohibited file present in source package (refuse to stage): $name under $SourcePackageDir"
  }
}

# Clear prior copies in dest. When Source==Dest, never delete required triple first (M1).
$destCleanup = @($prohibited + @("package_manifest.json", "hashes.txt"))
if (-not $sameDir) {
  $destCleanup = @($required + $destCleanup)
}
foreach ($name in $destCleanup) {
  $p = Join-Path $DestDir $name
  if (Test-Path -LiteralPath $p) {
    Remove-Item -LiteralPath $p -Force
  }
}

if (-not $sameDir) {
  foreach ($name in $required) {
    Copy-Item -LiteralPath (Join-Path $SourcePackageDir $name) -Destination (Join-Path $DestDir $name) -Force
  }
} else {
  Write-Host "SourcePackageDir == DestDir: skipping copy; refreshing manifest over existing triple."
}

# Refuse if prohibited names somehow landed in dest
foreach ($name in $prohibited) {
  if (Test-Path -LiteralPath (Join-Path $DestDir $name)) {
    throw "Prohibited file present in dest after copy: $name"
  }
}

$actual = @(Get-ChildItem -LiteralPath $DestDir -File |
  Where-Object { $_.Name -match '\.(inf|sys|cat)$' } |
  Select-Object -ExpandProperty Name |
  Sort-Object)

$expectedSorted = @($required | Sort-Object)
if (($actual -join "|") -ne ($expectedSorted -join "|")) {
  throw "Dest membership mismatch. Expected only [$($expectedSorted -join ', ')] but found [$($actual -join ', ')]"
}

$included = @()
foreach ($name in $required) {
  $p = Join-Path $DestDir $name
  $item = Get-Item -LiteralPath $p
  $hash = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash
  $sig = Get-AuthenticodeSignature -LiteralPath $p
  $role = switch ($name) {
    "ComponentizedAudioSample.inf" { "base_inf" }
    "TabletAudioSample.sys" { "driver_binary" }
    "talksync.cat" { "catalog" }
  }
  $included += [ordered]@{
    name                 = $name
    role                 = $role
    path                 = $p
    length               = $item.Length
    last_write_time      = $item.LastWriteTime.ToString("o")
    sha256               = $hash
    authenticode_status  = [string]$sig.Status
    signer_subject       = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { $null }
    timestamper_subject  = if ($sig.TimeStamperCertificate) { $sig.TimeStamperCertificate.Subject } else { $null }
  }
  Write-Host ("{0}  SHA256={1}  size={2}  authenticode={3}" -f $name, $hash, $item.Length, $sig.Status)
}

$manifest = [ordered]@{
  created_at   = (Get-Date).ToString("o")
  purpose      = "TalkSync attestation submit package (INF+SYS+talksync.cat only)"
  source_package = (Resolve-Path -LiteralPath $SourcePackageDir).Path
  stage_root   = (Resolve-Path -LiteralPath $DestDir).Path
  package_membership = [ordered]@{
    expected = $required
    actual   = $actual
    excluded_and_absent = $prohibited
    pass     = $true
  }
  notes = @(
    "No EV signing performed by this script.",
    "No driver install performed by this script.",
    "WDKTestCert signatures are dev-only; B1/B2 human gates required for production Code 52 clearance."
  )
  included_files = $included
}

$manifestPath = Join-Path $DestDir "package_manifest.json"
($manifest | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$hashesPath = Join-Path $DestDir "hashes.txt"
$included | ForEach-Object { "{0} {1} {2}" -f $_.name, $_.sha256, $_.length } |
  Set-Content -LiteralPath $hashesPath -Encoding ASCII

Write-Host ""
Write-Host "PASS: filtered package ready at $DestDir"
Write-Host "Manifest: $manifestPath"
Write-Host "Human next steps: EV sign (B1) then HDC attestation submit (B2). See docs/talksync/driver-attestation-submission-checklist.md"
