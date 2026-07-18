# Smoke: TalkSync driver attestation package readiness

| Field | Value |
|-------|-------|
| **Role** | smoke |
| **Task** | Package readiness smoke for TalkSync driver attestation |
| **Date** | 2026-07-18 |
| **Model** | grok-4.5 |
| **Package dir** | `C:\Users\user\Desktop\TalkSync_Driver\package_attestation_ready_20260718` |
| **Verdict** | **PASS** |
| **Hard ban** | No install/remove, EV PIN, HDC submit, or bcdedit performed |

## 1) Package directory listing

| Name | Size (bytes) | Present |
|------|-------------:|:-------:|
| ComponentizedAudioSample.inf | 13346 | yes |
| TabletAudioSample.sys | 101936 | yes |
| talksync.cat | 3980 | yes |
| hashes.txt | 280 | yes (aux) |
| package_manifest.json | 4165 | yes (aux) |

## 2) Required / prohibited membership

| Check | Result |
|-------|--------|
| ComponentizedAudioSample.inf present | PASS |
| TabletAudioSample.sys present | PASS |
| talksync.cat present | PASS |
| Extension INF absent | PASS (no `*Extension*` files) |
| sysvad.cat absent | PASS |

## 3) SHA256 hashes (`certutil -hashfile … SHA256`)

| File | SHA256 |
|------|--------|
| ComponentizedAudioSample.inf | `32be651ee2dca164ed8a433435c28f0df1905aac449beea25e28ef34c2a17363` |
| TabletAudioSample.sys | `5ca08b82e1ecba7fc11cdca9de64ba1dcf3c2136a2f6b42d5f935604c1d922e2` |
| talksync.cat | `d8cbe962010ba5477b49397377ddb8b1cae50b2166d2de6fb432437a6a2f09f6` |

Cross-check vs package `hashes.txt` / `package_manifest.json`: **match** (case-insensitive).

## 4) Authenticode (`signtool verify /pa /v`)

| File | signtool available | Verify | Signer |
|------|:------------------:|:------:|--------|
| TabletAudioSample.sys | yes (`Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe`) | **Successfully verified** | `WDKTestCert user,134189977194030591` (self-issued) |
| talksync.cat | yes | **Successfully verified** | `WDKTestCert user,134189977194030591` (self-issued) |

Notes:

- Expected dev signer is WDKTestCert — **confirmed**.
- Neither signature is timestamped.
- SYS reported page hashes present.
- Production Code 52 still requires human B1 (EV) + B2 (HDC) — out of scope for this smoke.

## 5) Docs and prepare script

| Artifact | Path | Result |
|----------|------|--------|
| Readiness doc | `docs/talksync/driver-attestation-readiness.md` | PASS |
| Submission checklist | `docs/talksync/driver-attestation-submission-checklist.md` (task shorthand: submission-checklist.md) | PASS |
| Research | `docs/talksync/driver-attestation-research.md` (task shorthand: research.md) | PASS |
| Prepare script | `scripts/driver/prepare-attestation-package.ps1` | PASS |

Literal basenames `submission-checklist.md` / `research.md` are absent; canonical `driver-attestation-*` names are present and used by the pipeline.

## 6) Prepare script safety audit

File: `scripts/driver/prepare-attestation-package.ps1`

| Banned capability | Executable call present? | Notes |
|-------------------|:------------------------:|-------|
| pnputil | no | Mentioned only in comment “Does NOT … run pnputil/devcon” |
| devcon | no | Same comment only |
| signtool / sign | no | Script only reads Authenticode via `Get-AuthenticodeSignature` |
| HDC submit | no | Help text / “Human next steps” Write-Host only |
| Driver install/remove | no | Notes string only; actions are Copy-Item + hash + JSON write |
| bcdedit | no | — |

Script behavior: copy INF/SYS/CAT triple, refuse prohibited names, write `package_manifest.json` + `hashes.txt`. **PASS** — no install/pnputil/devcon/sign/HDC calls.

## Residual (not smoke failures)

- B1 EV signing + PIN: human gate, not run.
- B2 HDC attestation submit: human gate, not run.
- WDKTestCert is dev-only; not production Microsoft attestation.

## Final verdict

**PASS** — attestation-ready package membership, hashes, WDKTestCert signatures, docs, and prepare-script safety all check out under hard bans (no install/EV/HDC/bcdedit).
