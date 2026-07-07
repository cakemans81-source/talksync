# TalkSync Windows Release Checklist

Use this checklist for local Windows releases signed with the EV USB token.

## Before Build

- Confirm the working tree has no unexpected tracked changes.
- Confirm `package-lock.json` is current.
- Confirm the EV USB token is present on the release machine.
- Confirm the certificate is visible in `Cert:\CurrentUser\My`.
- Confirm `signtool.exe` is installed or note the explicit `-SignToolPath`.
- Confirm the certificate thumbprint is available only to the release operator.
- Confirm the PIN is not stored anywhere.

## Build

- Run a dry-run:

```powershell
npm run build:win-release -- -- -DryRun
```

- Run the real release build:

```powershell
npm run build:win-release -- -- `
  -Thumbprint "YOUR_CERT_THUMBPRINT" `
  -TimestampUrl "http://timestamp.digicert.com"
```

- If using a custom Windows SDK path:

```powershell
npm run build:win-release -- -- `
  -Thumbprint "YOUR_CERT_THUMBPRINT" `
  -SignToolPath "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"
```

## Signing Checks

- `dist-electron\win-unpacked\TalkSync.exe` is signed and valid.
- `dist-electron\win-unpacked\resources\elevate.exe` is signed and valid.
- Every `dist-electron\TalkSync-Setup*.exe` installer intended for upload is
  signed and valid.
- Timestamp information is present.
- No thumbprint or PIN was written into committed files.

Run:

```powershell
npm run verify:win-signatures
```

## Install Test

- Test on a clean Windows user profile or clean Windows VM.
- Install with the generated NSIS setup EXE.
- Confirm Windows shows the expected publisher.
- Launch TalkSync from the Start Menu shortcut.
- Confirm the `talksync://` OAuth protocol still opens the app.
- Confirm microphone permission flow still works.
- Confirm the app can detect the expected virtual audio device.
- Confirm uninstall completes without deleting unrelated user data.

## SmartScreen And Defender

- Record whether SmartScreen still warns on first download.
- Record Defender or Smart App Control warnings, if any.
- Keep the signed file hash and release version in the release notes.
- Expect reputation to improve over time after consistent signed releases.

## Distribution

- Upload only the signed installer.
- If publishing `latest.yml` for an updater later, verify its SHA512 matches the
  final signed installer bytes.
- Do not publish unsigned backup installers.
- Keep driver packages separate from the app installer unless a separate driver
  signing and licensing ticket has completed.

## Out Of Scope For This Checklist

- `.sys`, `.inf`, `.cat` driver signing.
- Microsoft Hardware Dev Center, HLK, or attestation signing.
- VB-CABLE bundling, redistribution licensing, or silent installation.
- Adding a new runtime auto-updater.
