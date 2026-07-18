# TalkSync Driver Attestation — Submission Checklist

**Audience:** Human operator with EV token access and Hardware Dev Center (HDC) / Partner Center enrollment.  
**Related:** [`driver-attestation-readiness.md`](./driver-attestation-readiness.md), [`driver-attestation-research.md`](./driver-attestation-research.md)  
**Ticket:** ORCA-TALKSYNC-DRIVER-ATTESTATION-READINESS-PIPELINE-1

This document separates **agent-safe prep** from **human-only gates**. Agents and automation **must not** enter EV PINs, submit to HDC, download Microsoft-signed returns on behalf of a human, or install drivers on user machines as “proof.”

---

## A. Pre-submit package (may be agent-assisted)

Use the filtered triple only. Never submit a raw dirty build folder that still contains Extension INF or `sysvad.cat`.

### A1. Confirm package membership

Preferred staged folder (example date stamp):

`C:\Users\user\Desktop\TalkSync_Driver\package_attestation_ready_YYYYMMDD`

Required files **only**:

| File | Role |
|------|------|
| `ComponentizedAudioSample.inf` | Base INF (`CatalogFile=talksync.cat`) |
| `TabletAudioSample.sys` | Kernel driver |
| `talksync.cat` | Catalog covering INF+SYS (will be replaced after production re-sign) |

**Must be absent:**

- `ComponentizedAudioSampleExtension.inf`
- `ComponentizedApoSample.inf` (or any APO INF)
- `sysvad.cat`

Optional helper:

```powershell
pwsh -File scripts/driver/prepare-attestation-package.ps1 `
  -SourcePackageDir "C:\Users\user\Desktop\TalkSync_Driver\Windows-driver-samples\audio\sysvad\x64\Release\package" `
  -DestDir "C:\Users\user\Desktop\TalkSync_Driver\package_attestation_ready_YYYYMMDD"
```

### A2. Confirm INF product fields

| Field | Expected |
|-------|----------|
| CatalogFile | `talksync.cat` |
| Hardware ID | `Root\talksync_TalkSyncAudio` |
| Service | `TalkSyncAudio` |
| Provider / Manufacturer | TalkSync |
| Render friendly name | `TalkSync Virtual Speaker (Rx)` |
| Capture friendly name | `TalkSync Virtual Microphone (Tx)` |

### A3. Record SHA256 before production signing

```powershell
Get-ChildItem <stage> -Include *.inf,*.sys,*.cat -Recurse |
  Get-FileHash -Algorithm SHA256
```

Store hashes in `package_manifest.json` (helper writes this) and keep a copy for audit.

### A4. Source hygiene (recommended)

- Driver tree: only base INX packaged (B3 fix in `TabletAudioSample.vcxproj`).
- Clean rebuild: `msbuild sysvad.sln /p:Configuration=Release /p:Platform=x64 /t:Rebuild`
- Wipe `x64\Release\package` before rebuild if prior Extension leftovers exist.
- Do **not** commit `.sys`/`.cat` into the TalkSync app git repo.

---

## B. Human gates only (B1 / B2)

### B1 — EV code signing (BLOCKER for Code 52)

Perform on a secured signing machine with the EV token attached. **Do not script PIN entry.**

1. EV-sign `TabletAudioSample.sys` (sha256 digest).
2. Prefer Authenticode **timestamp** (production).
3. Run Inf2Cat over the **final** INF+SYS set → produce/update `talksync.cat`  
   (`CatalogFile` in INF must remain `talksync.cat`).
4. EV-sign `talksync.cat` (and timestamp if policy requires).
5. Verify:

```text
signtool verify /pa /v TabletAudioSample.sys
signtool verify /pa /v talksync.cat
```

Signer must be the **EV certificate**, not `WDKTestCert`.

6. Re-hash the triple and archive pre-HDC submission package.

### B2 — Hardware Dev Center attestation (BLOCKER)

1. Confirm Partner Center / Hardware Dev Center enrollment and attestation eligibility for this kernel-mode **MEDIA** driver.
2. Decision (product preference from planning docs): **Attestation signing** (faster, preferred for user-install) vs full HLK/WHQL.
3. Create / open the hardware submission.
4. Upload the **filtered EV-signed triple only** (INF + SYS + CAT).  
   Do **not** include Extension INF or `sysvad.cat`.
5. Complete required metadata (name, architecture x64, target OS, etc.).
6. Submit and wait for Microsoft processing.
7. Download Microsoft-attested / signed return artifacts.
8. Reassemble installable package from Microsoft returns; record new hashes.
9. **Do not** treat WDKTestCert package as production-ready after this step — only Microsoft-returned signed bits clear Code 52 on stock Windows.

---

## C. Post-attestation validation (human / dedicated test machine)

**Still out of scope for unattended agents on developer machines** unless explicitly authorized:

1. On a **clean Windows** install **without** testsigning:
   - Install driver package via supported path.
   - Confirm device starts without **Code 52**.
2. Confirm endpoints appear:
   - `TalkSync Virtual Speaker (Rx)`
   - `TalkSync Virtual Microphone (Tx)`
3. Run TalkSync app isolation hard-gate + Virtual Mic Tx path smoke checks.
4. Archive production package + hashes + submission IDs for release notes.

App installer EV signing remains **separate** (`docs/release/windows-code-signing.md`); it does **not** sign the kernel driver.

---

## D. Explicit bans (agents and unsafe automation)

| Banned | Why |
|--------|-----|
| EV PIN / token unlock automation | Secret handling; human-only |
| Live HDC submit / Microsoft download by agent | Account ownership + approval |
| `pnputil` / `devcon` / driver install-remove on user PC | Machine state risk |
| `bcdedit`, Test Mode, Secure Boot flips as “proof” | Security posture |
| Submitting `x64\Release\package` with Extension/`sysvad.cat` | Contaminates attestation mix |
| Committing `.sys`/`.cat` into app repo | Binary policy |

---

## E. Quick decision tree

```text
Is package membership exactly INF + SYS + talksync.cat?
  NO  → rebuild with B3 fix / clean package dir / prepare-attestation-package.ps1
  YES → Are SYS+CAT EV-signed (not WDKTestCert)?
          NO  → B1 human EV sign + Inf2Cat + re-sign CAT
          YES → Submit filtered triple to HDC attestation (B2)
                  → replace with Microsoft return package
                  → validate Code 52 gone on clean OS
```

---

## F. Residual product nits (optional, not submit blockers)

- Filenames still sample-shaped (`TabletAudioSample.sys`, `ComponentizedAudioSample.inf`).
- Cosmetic `SYSVAD_MIDI` string residue in INF.
- DriverVer stamp policy / private git remote for TalkSync driver tree.

None of the above block attestation **if** identity fields and package membership are correct and B1/B2 complete.
