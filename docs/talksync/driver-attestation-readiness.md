# TalkSync Driver Attestation Readiness

**Ticket:** ORCA-TALKSYNC-DRIVER-ATTESTATION-READINESS-PIPELINE-1  
**Phase:** C+D implement (minimal B3 packaging fix + docs)  
**Date:** 2026-07-18  
**Model:** grok-4.5  
**Verdict:** **PARTIAL / package-path PASS** — submit package membership is now clean; production Code 52 clearance still blocked by human gates **B1/B2**.

Research baseline: [`driver-attestation-research.md`](./driver-attestation-research.md)  
Submission steps (human-only): [`driver-attestation-submission-checklist.md`](./driver-attestation-submission-checklist.md)

---

## 1. Status summary

| Area | Status | Notes |
|------|--------|-------|
| Product INF identity (HWID, service, endpoints, CatalogFile) | **PASS** | Unchanged product shape |
| Build package membership (no Extension / no sysvad.cat) | **PASS (fixed B3)** | Clean rebuild emits INF+SYS+`talksync.cat` only |
| Staged attestation-ready folder | **PASS** | See §3 |
| Production signature / Code 52 | **BLOCKED (B1)** | Still WDKTestCert only |
| HDC / EV / Microsoft attestation pipeline | **BLOCKED (B2)** | Human gates only — not performed |
| Agent bans held | **PASS** | No EV PIN, no HDC submit, no install, no app feature code |

**Overall:** Package composition is attestation-**submit-shape** ready. Signing trust for end users is **not** ready until B1/B2 complete.

---

## 2. B3 fix result (driver source)

**File:**  
`C:\Users\user\Desktop\TalkSync_Driver\Windows-driver-samples\audio\sysvad\TabletAudioSample\TabletAudioSample.vcxproj`

**Before:**
```xml
<Inf Exclude="@(Inx);ComponentizedApoSample.inx" Include="*.inx" />
```

**After (minimal):**
```xml
<Inf Exclude="@(Inx);ComponentizedAudioSampleExtension.inx;ComponentizedApoSample.inx" Include="ComponentizedAudioSample.inx" />
```

**Effect:** MSBuild packages only `ComponentizedAudioSample.inx` → stamped `ComponentizedAudioSample.inf`. Extension and APO INX are excluded, so Inf2Cat no longer emits `sysvad.cat` for those samples when the package dir is clean.

**Git note:** Driver source change is **left uncommitted** in the Microsoft samples tree (dirty local TalkSync work). Commit only in a later commit-push phase after QA if desired. **Do not** commit `.sys`/`.cat` binaries into the app repo.

---

## 3. Package paths

| Role | Path |
|------|------|
| MSBuild package output (after clean Rebuild) | `C:\Users\user\Desktop\TalkSync_Driver\Windows-driver-samples\audio\sysvad\x64\Release\package` |
| Attestation-ready staged folder (2026-07-18) | `C:\Users\user\Desktop\TalkSync_Driver\package_attestation_ready_20260718` |
| Prior filtered staging (historical) | `C:\Users\user\Desktop\TalkSync_Driver\package_user_facing_names_20260708` |
| Driver source root | `C:\Users\user\Desktop\TalkSync_Driver\Windows-driver-samples\audio\sysvad` |

**Staged membership (exact triple + metadata):**

- `ComponentizedAudioSample.inf`
- `TabletAudioSample.sys`
- `talksync.cat`
- `package_manifest.json` (SHA256 + build notes)

**Absent (required):** `ComponentizedAudioSampleExtension.inf`, `ComponentizedApoSample.inf`, `sysvad.cat`

Helper script (app repo, optional): `scripts/driver/prepare-attestation-package.ps1` — copies only the safe triple and writes a SHA256 manifest from a given package dir (no EV sign, no install).

---

## 4. Build result (Release \| x64)

| Item | Result |
|------|--------|
| Tool | `MSBuild.exe` VS 18 Community |
| Command | `msbuild sysvad.sln /p:Configuration=Release /p:Platform=x64 /t:Rebuild` |
| Package membership after clean rebuild | **PASS** — exactly INF + SYS + `talksync.cat` |
| Inf2Cat | Errors: None / Warnings: None |
| Catalog generated | **only** `talksync.cat` |
| Sign (dev) | WDKTestCert on SYS + CAT |

**Residual tooling nits (non-blocking for package membership):**

1. `InfVerif.dll` x86 load exception during INF stamp (`HRESULT: 0x8007007E`) — non-fatal; project has `InfVerif_NeedsValidation=false`. Toolchain install quirk on this machine.
2. MSB4011 duplicate WDK props import warnings.

**Stale-dir warning:** If an old `x64\Release\package` still contains `ComponentizedAudioSampleExtension.inf`, a non-clean rebuild can leave it and Inf2Cat may recreate `sysvad.cat`. Prefer `/t:Rebuild` with a wiped package dir, or restage via `prepare-attestation-package.ps1`.

---

## 5. Hashes (package_attestation_ready_20260718)

Recorded 2026-07-18 after clean Rebuild + restage. Signatures are **WDKTestCert** (dev only).

| File | Size | SHA256 |
|------|------|--------|
| `ComponentizedAudioSample.inf` | 13346 | `32BE651EE2DCA164ED8A433435C28F0DF1905AAC449BEEA25E28EF34C2A17363` |
| `TabletAudioSample.sys` | 101936 | `5CA08B82E1ECBA7FC11CDCA9DE64BA1DCF3C2136A2F6B42D5F935604C1D922E2` |
| `talksync.cat` | 3980 | `D8CBE962010BA5477B49397377DDB8B1CAE50B2166D2DE6FB432437A6A2F09F6` |

Authenticode (PowerShell `Get-AuthenticodeSignature`):

| File | Status | Signer |
|------|--------|--------|
| INF | UnknownError (expected for bare INF) | — |
| SYS | Valid | `CN="WDKTestCert user,134189977194030591"` |
| CAT | Valid | same WDKTestCert |

**Note:** Rebuilds change DriverVer stamp and SYS/CAT hashes. Re-run staging + update this table before any HDC submit.

INF product fields (verified on stamped package INF):

| Field | Value |
|-------|--------|
| CatalogFile | `talksync.cat` |
| Hardware ID | `Root\talksync_TalkSyncAudio` |
| Service | `TalkSyncAudio` |
| Device desc | `TalkSync Virtual Audio Cable` |
| Render | `TalkSync Virtual Speaker (Rx)` |
| Capture | `TalkSync Virtual Microphone (Tx)` |
| Provider / Mfg | TalkSync |

---

## 6. Blockers remaining (human gates — not done by agent)

| ID | Severity | Item | Owner |
|----|----------|------|--------|
| **B1** | **BLOCKER** | Replace WDKTestCert with **EV code-signing** of SYS (+ CAT after Inf2Cat), preferably with Authenticode timestamp. Without this, production Windows reports **Code 52**. | Human / signing machine |
| **B2** | **BLOCKER** | **Hardware Dev Center / Partner Center** attestation (or WHQL) submission, Microsoft-signed return package, reassembly. Agent must not handle EV PIN or live submit. | Human |
| B3 | ~~HIGH~~ **FIXED** | Build package contamination (Extension + sysvad.cat) | Agent implement 2026-07-18 |

B1/B2 detailed steps: [`driver-attestation-submission-checklist.md`](./driver-attestation-submission-checklist.md).

---

## 7. What was intentionally not done

- No EV PIN entry, EV signing, HDC submit, or Microsoft download
- No driver install/remove, `pnputil`, `devcon`, `bcdedit`, Secure Boot / Test Mode changes
- No app feature code changes under `src/` / Electron product logic
- No large driver topology/routing logic changes
- No binary `.sys`/`.cat` commit to this app repo
- Driver vcxproj change left **uncommitted** in samples tree

---

## 8. App repo files touched by this implement pass

| Path | Action |
|------|--------|
| `docs/talksync/driver-attestation-readiness.md` | created (this file) |
| `docs/talksync/driver-attestation-submission-checklist.md` | created |
| `scripts/driver/prepare-attestation-package.ps1` | created (optional helper) |
| `docs/talksync/driver-attestation-research.md` | read-only baseline (prior research) |

Outside app repo (driver machine paths):

- `TabletAudioSample.vcxproj` Inf packaging line (B3)
- `package_attestation_ready_20260718\` staged triple + manifest

---

## 9. Coordinator payload

```text
role=implement
verdict=pass
fixLoop=0
model=grok-4.5
filesModified=docs/talksync/driver-attestation-readiness.md,docs/talksync/driver-attestation-submission-checklist.md,scripts/driver/prepare-attestation-package.ps1
driverModified=Windows-driver-samples/audio/sysvad/TabletAudioSample/TabletAudioSample.vcxproj
stagedOutsideRepo=C:\Users\user\Desktop\TalkSync_Driver\package_attestation_ready_20260718
build=PASS Release|x64 clean membership INF+SYS+talksync.cat
residual=B1,B2 human gates
```
