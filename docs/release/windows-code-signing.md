# TalkSync Windows Code Signing

This guide describes the local Windows release signing flow for the TalkSync
Electron/NSIS build. It is designed for an EV code-signing certificate stored on
a USB token.

## Non-negotiables

- Do not commit the certificate thumbprint.
- Do not store the USB token PIN in scripts, docs, environment variables, shell
  history, CI logs, or release logs.
- Use SHA-256 file digest and RFC 3161 timestamping.
- Sign user-executed EXE files before distribution.
- Sign every `.exe` discovered under `dist-electron\win-unpacked`.
- Driver signing is out of scope here. `.sys`, `.inf`, and `.cat` files require
  a separate driver-signing process.
- VB-CABLE bundling, licensing, and installation automation are out of scope.

## Build Structure

TalkSync uses Next.js export output plus Electron and electron-builder:

```powershell
npm run build:app
npx electron-builder --win --publish never
```

The important Windows artifacts are:

- `dist-electron\win-unpacked\TalkSync.exe`
- any other `.exe` discovered under `dist-electron\win-unpacked`
- `dist-electron\win-unpacked\resources\elevate.exe`, if electron-builder emits
  it for the current NSIS build
- `dist-electron\TalkSync-Setup-*.exe`
- installed `Uninstall TalkSync.exe`, verified after running the installer

Electron runtime DLLs are not first-pass signing targets in this project. They
are third-party runtime files produced by Electron/electron-builder. The local
TalkSync executable, any emitted helper executable, and installer are the primary
files users execute or Windows reputation systems inspect.

The release build uses `win.signtoolOptions.sign` to run
`scripts\electron-builder-sign-win.cjs` inside electron-builder's own signing
flow. This is important for NSIS because electron-builder creates and signs
`resources\elevate.exe`, `__uninstaller-*.exe`, and the final setup executable
during installer generation.

## Find The Certificate Thumbprint

Use Windows certificate tools on the release machine after the EV USB token is
available:

```powershell
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.HasPrivateKey } |
  Select-Object Subject, Thumbprint, NotAfter
```

Copy only the thumbprint. Do not copy or record the PIN.

## Find signtool

`scripts\sign-win.ps1` searches common Windows SDK locations automatically. You
can also pass the path explicitly:

```powershell
.\scripts\sign-win.ps1 `
  -SignToolPath "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe" `
  -Thumbprint "YOUR_CERT_THUMBPRINT" `
  -Files "dist-electron\win-unpacked\TalkSync.exe"
```

Install the Windows SDK if `signtool.exe` is unavailable.

## Timestamp URLs

Use one RFC 3161 timestamp server:

- `http://timestamp.digicert.com`
- `http://timestamp.sectigo.com`
- `http://timestamp.globalsign.com/tsa/r6advanced1`
- `http://ts.ssl.com`

The default script value is `http://timestamp.digicert.com`.

## Recommended Release Flow

Dry-run first:

```powershell
.\scripts\build-win-release.ps1 -DryRun
```

Then run the release build on the Windows machine with the USB token inserted:

```powershell
.\scripts\build-win-release.ps1 `
  -Thumbprint "YOUR_CERT_THUMBPRINT" `
  -TimestampUrl "http://timestamp.digicert.com"
```

The script performs this order:

1. Clean `dist-electron` so stale installers cannot be mistaken for the current
   release.
2. Build the Next.js export and Electron main/preload output with
   `npm run build:app`.
3. Set local process environment variables for the custom electron-builder
   signer: `TALKSYNC_WIN_CERT_THUMBPRINT` and `TALKSYNC_WIN_TIMESTAMP_URL`.
4. Run `electron-builder --win --publish never`.
5. Let electron-builder call the custom signer for app EXEs, the NSIS elevate
   helper, the generated uninstaller, and the final setup executable.
6. Verify the app, discovered helper executables, and installer signatures.

## Manual Signing

To sign specific files manually:

```powershell
.\scripts\sign-win.ps1 `
  -Thumbprint "YOUR_CERT_THUMBPRINT" `
  -TimestampUrl "http://timestamp.digicert.com" `
  -Files @(
    "dist-electron\win-unpacked\TalkSync.exe",
    "dist-electron\TalkSync-Setup-0.1.0.exe"
  )
```

To preview without signing:

```powershell
.\scripts\sign-win.ps1 `
  -DryRun `
  -Thumbprint "0000000000000000000000000000000000000000" `
  -Files "dist-electron\win-unpacked\TalkSync.exe"
```

When calling through npm on Windows, pass an extra `--` before PowerShell
switches:

```powershell
npm run sign:win -- -- `
  -DryRun `
  -Thumbprint "0000000000000000000000000000000000000000" `
  -Files "dist-electron\win-unpacked\TalkSync.exe,dist-electron\TalkSync-Setup-0.1.0.exe"
```

## Verify Signatures

```powershell
.\scripts\verify-win-signatures.ps1 -DistDir "dist-electron"
```

or:

```powershell
npm run verify:win-signatures
```

The verifier fails on `NotSigned`, `UnknownError`, `HashMismatch`, and any other
non-`Valid` Authenticode status.

After installing the signed setup executable, verify the installed files too:

```powershell
.\scripts\verify-win-signatures.ps1 `
  -DistDir "dist-electron" `
  -InstalledDir "$env:LOCALAPPDATA\Programs\TalkSync"
```

The installed-path verification must pass for every installed `.exe`, including
`TalkSync.exe`, `resources\elevate.exe` if present, and
`Uninstall TalkSync.exe`.

## Updater And latest.yml

`dist-electron\latest.yml` and `app-update.yml` can be generated by
electron-builder. This project does not currently wire a runtime auto-updater in
the Electron main process.

If auto-updates are enabled later, keep signing inside electron-builder's
signing flow so update metadata is generated against final signed bytes. Do not
edit or re-sign the installer after `latest.yml` has been finalized unless you
also regenerate the update metadata.
