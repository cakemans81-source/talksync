# TalkSync Driver Attestation Readiness — Phase A+B Research

**Ticket:** ORCA-TALKSYNC-DRIVER-ATTESTATION-READINESS-PIPELINE-1  
**Role:** research (read-only)  
**Date:** 2026-07-18  
**Model:** grok-4.5  
**Verdict:** **PARTIAL** — user-facing package content meets product/INF readiness; production (EV + Microsoft attestation) signing is still the hard gate for Code 52.

---

## 1. App repo state

| Item | Value |
|------|--------|
| Path | `C:\Users\user\Desktop\AI 툴\수익화프로젝트\talksync` |
| Branch | `main` |
| HEAD | `31c998670fa1f8bca4b47a27836d43dede11a07e` |
| origin/main | `31c998670fa1f8bca4b47a27836d43dede11a07e` (identical) |
| Tip message | `feat: Live Translate isolation hard-gate before start` |
| Note on ticket baseline | Coordinator expected older `a28f851`; isolation hard-gate is already on main at HEAD |

**Working tree (do not touch for this ticket):**

- Modified tracked: `docs/qa-isolation-hard-gate-report.md`
- Untracked (preserve): `docs/MASTER_CONTEXT.md`, `docs/project-structure-report.md`, `.codex/`, `UpdateAudioDriver.bat`, `scratch/`

No app feature code was changed by this research pass.

---

## 2. Driver source git state

| Item | Value |
|------|--------|
| Toplevel | `C:/Users/user/Desktop/TalkSync_Driver/Windows-driver-samples` |
| Branch | `main` tracking `origin/main` |
| HEAD | `ef8faf9f4e187d354660804da007f2ad0f4a55a3` (upstream Microsoft sample merge tip) |
| Remote | `https://github.com/microsoft/Windows-driver-samples.git` |
| Dirty summary | ~13 modified, ~15 deleted, ~15 untracked (~43 porcelain lines) — **many local TalkSync mods, uncommitted** |

**TalkSync-relevant local work (representative):**

- New: `EndpointsCommon/talksync_loopback.{cpp,h}`, `talksync_topo.{cpp,h}`, `talksync_wavtable.h`, `lookaside_win10_compat.c`, `Directory.Build.props`
- Heavily modified: `TabletAudioSample/ComponentizedAudioSample.inx`, `minipairs.h`, minwavert stream/path, package project
- Deleted sample endpoints: HDMI/SPDIF/micarray/micin topo sources (virtual-cable-only shape)
- Source still contains APO tree + `ComponentizedAudioSampleExtension.inx` / `ComponentizedApoSample.inx` (sample residue)

**Do not commit** from this research task.

---

## 3. Package directory inventory

**Expected package root:**  
`C:\Users\user\Desktop\TalkSync_Driver\package_user_facing_names_20260708`

| File | Role | Size | LastWrite (local) | SHA256 (certutil) |
|------|------|------|-------------------|-------------------|
| `ComponentizedAudioSample.inf` | base INF | 13342 | 2026-07-08 09:09:53 | `D819A045503F106AED97F35B4B0B9B9E8626DB48BF9A7DA6EBB37E0D81CFC203` |
| `TabletAudioSample.sys` | driver binary | 101936 | 2026-07-08 08:56:33 | `F7CD0980B2232EEFF84863F14C9B91B300E4D5E8094AC10D979F1C9A84B72D1D` |
| `talksync.cat` | catalog | 3922 | 2026-07-08 09:09:54 | `15F7BD60837A38D9564746E4B79B76B4A1BBC90673083FC42f30061C246A20BA` |
| `package_manifest.json` | staging metadata | 3065 | 2026-07-08 09:10:17 | (meta) |
| `user_facing_names_report.md` | build notes | 887 | 2026-07-08 09:10:17 | (meta) |

**Hashes match** `package_manifest.json` included digests (case-insensitive).

**Staged package does NOT include:**

- `ComponentizedAudioSampleExtension.inf`
- `sysvad.cat`

### Build output vs staged package

MSBuild package dir  
`...\audio\sysvad\x64\Release\package` still contains **five** files:

| File | In build package | In staged submit package |
|------|------------------|--------------------------|
| `ComponentizedAudioSample.inf` | yes | yes |
| `TabletAudioSample.sys` | yes | yes |
| `talksync.cat` | yes | yes |
| `ComponentizedAudioSampleExtension.inf` | **yes** | **no** |
| `sysvad.cat` | **yes** | **no** |

Root cause: `TabletAudioSample.vcxproj` packs `*.inx` excluding only `ComponentizedApoSample.inx`, so **Extension.inx still ships into the build package**:

```xml
<Inf Exclude="@(Inx);ComponentizedApoSample.inx" Include="*.inx" />
```

Staged folder is a **manual/filtered** snapshot, not a clean single-INF package build.

---

## 4. INF inspection (staged `ComponentizedAudioSample.inf`)

Encoding: UTF-16 LE (`FF FE`) — normal for WDK-generated INF.

| Field | Value | Criteria |
|-------|--------|----------|
| Signature | `$Windows NT$` | OK |
| Class | `MEDIA` | OK |
| ClassGuid | `{4d36e96c-e325-11ce-bfc1-08002be10318}` | OK (media) |
| Provider | `TalkSync` (`%ProviderName%`) | OK |
| Manufacturer / MfgName | `TalkSync` | OK |
| CatalogFile | **`talksync.cat`** | **PASS** |
| DriverVer | `07/08/2026,9.9.53.510` | stamped by build/inf2cat path |
| PnpLockDown | `1` | OK |
| Hardware ID | **`Root\talksync_TalkSyncAudio`** | **PASS** (exact expected form) |
| Service name | **`TalkSyncAudio`** | **PASS** |
| ServiceBinary | `%13%\TabletAudioSample.sys` | OK (DriverStore copy) |
| CopyList / SourceDisksFiles | `tabletaudiosample.sys` | OK (case-insensitive on Windows) |
| Device desc | `TalkSync Virtual Audio Cable` | OK |
| Render friendly name | **`TalkSync Virtual Speaker (Rx)`** | **PASS** |
| Capture friendly name | **`TalkSync Virtual Microphone (Tx)`** | **PASS** |
| AddInterface | Wave/Topology Tx (RENDER) + Rx (CAPTURE) + AUDIO/REALTIME | OK |
| Internal KS names | `WaveTalkSyncTx` / `WaveTalkSyncRx` (+ topology pairs) | intentional internal |
| Extension INF | **none in this file / staged package** | PASS for submit mix |
| WDKTestCert string in INF | none | N/A (signing is on SYS/CAT) |
| TODO / FIXME | **none** | PASS |

**Residual nit in INF:**

- `SYSVAD_MIDI = "MIDI"` and midi driver description still reference sample MIDI subclass registration. Cosmetic residue; not submit-blocking for virtual cable.

**Source INX alignment:**  
`TabletAudioSample/ComponentizedAudioSample.inx` matches staged INF content (CatalogFile, HWID, service, endpoint strings). Source `DriverVer` placeholder differs until package stamp (`03/26/2026,1.0.0.1` in INX vs stamped `07/08/2026,9.9.53.510` in package INF).

---

## 5. Signature verification (`signtool verify /pa /v`)

**Tool:**  
`C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe`

| Artifact | Result | Signer | Timestamp |
|----------|--------|--------|-----------|
| `TabletAudioSample.sys` | **Successfully verified** | `CN="WDKTestCert user,134189977194030591"` (self-issued test cert) | **None** |
| `talksync.cat` | **Successfully verified** | same WDKTestCert | **None** |

PowerShell `Get-AuthenticodeSignature` also reports **Valid** for both.

**Implication:**

- Signatures are cryptographically consistent for **testsigning / dev** environments.
- WDKTestCert is **not** a production trust chain → production machines will still hit **Code 52** (Windows cannot verify the publisher) until EV + Microsoft attestation (or WHQL) replaces these signatures.
- No Authenticode timestamp — fine for local test; production signing should timestamp.

`package_manifest.json` already records:

- SYS/CAT: Valid + WDKTestCert
- INF: `authenticode_status: UnknownError` (INF itself is not the primary Authenticode object; catalog covers package)

---

## 6. App references (virtual devices / driver / attestation)

### Runtime binding (product contracts match INF names)

`src/lib/audioDeviceBinding.ts`:

- `isTalkSyncSpeakerRx`: audiooutput + label contains `talksync` + (`speaker` or standalone `rx`)
- `isTalkSyncMicrophoneTx`: audioinput + label contains `talksync` + (`microphone`/`mic` or standalone `tx`)
- Exact mode: **TalkSync Virtual Speaker (Rx)** + **TalkSync Virtual Microphone (Tx)** friendly names from INF satisfy these matchers

`src/lib/isolationHardGate.ts` (already on main):

- Blocks full isolation when TalkSync Virtual Speaker(Rx)/Microphone(Tx) pair is missing
- Depends on binding helpers above — **aligned with current INF endpoint strings**

### Install / ops helpers (untracked)

`UpdateAudioDriver.bat` (untracked in app repo):

- Stops/starts service `TalkSyncAudio`
- Copies `TabletAudioSample.sys` → `System32\drivers`
- `devcon install ... Root\talksync_TalkSyncAudio`

### Docs / product planning

| Doc | Relevance |
|-----|-----------|
| `docs/MASTER_CONTEXT.md` (untracked) | Phase 2 Driver Attestation + Code 52; prefers Attestation Signing for user-install product |
| `docs/release/windows-code-signing.md` | App/EV installer signing only; **driver signing explicitly out of scope** |
| `docs/release/windows-release-checklist.md` | Explicitly excludes `.sys/.inf/.cat`, HDC, HLK, attestation |
| Studio UI / pipeline | Driver-free browser tab path vs driver-gated 양방향 치환 |

App has **no automated HDC/attestation pipeline**. Driver signing is a separate human-gated process.

Note: `startVAD` / `SysVAD` identifiers in app code are **speech VAD helpers**, not the Windows SYSVAD sample package.

---

## 7. Driver source residues (rg summary)

| Search | Finding |
|--------|---------|
| `Root\talksync` / `TalkSyncAudio` | Present in `ComponentizedAudioSample.inx` and staged INF |
| Endpoint strings | Virtual Speaker (Rx) / Microphone (Tx) in INX + INF |
| `CatalogFile = talksync.cat` | Base INX/INF **yes** |
| `CatalogFile = sysvad.cat` | Still on **`ComponentizedAudioSampleExtension.inx`** and **`ComponentizedApoSample.inx`** |
| Extension INF | Source + **build package** still emit Extension; **staged package does not** |
| sysvad residues | README still documents `sysvad.cat` / Extension install; MIDI string `SYSVAD_MIDI`; internal type names `SYSVAD_DEVPROPERTY` etc. (code heritage, not user-facing) |
| Loopback implementation | Present (`talksync_loopback` ring buffer Tx→Rx) — product feature intact in source |

Package project references **only** `TabletAudioSample` (good). Solution still lists APO projects (not required for TalkSync base package).

---

## 8. Readiness criteria checklist

| Criterion | Status | Evidence |
|-----------|--------|----------|
| INF/SYS/CAT complete in submit package | **PASS** | All three present with matching hashes |
| `CatalogFile=talksync.cat` | **PASS** | Staged INF + source INX |
| HW ID `Root\talksync_TalkSyncAudio` | **PASS** | Exact string |
| Service `TalkSyncAudio` | **PASS** | `AddService` + service inst |
| Endpoints Virtual Speaker (Rx) / Virtual Microphone (Tx) | **PASS** | INF strings + app matchers |
| No `sysvad.cat` / Extension INF as submit mix-in | **PASS (staged)** / **FAIL (raw build package)** | Staged clean; `x64\Release\package` still mixed |
| WDKTestCert = dev only; EV/Microsoft still needed for Code 52 | **PASS understanding** / **BLOCKER for prod** | signtool shows WDKTestCert only |

---

## 9. Blocker list (severity)

### Blockers (must resolve before production Code 52 clearance)

| ID | Severity | Item |
|----|----------|------|
| B1 | **BLOCKER** | **No production driver signature.** SYS+CAT are WDKTestCert-only. Production Windows will treat package as untrusted (Code 52) until EV code-signing + **Microsoft attestation** (or full WHQL) replaces test signatures. |
| B2 | **BLOCKER** | **Human-gate pipeline not run:** Hardware Dev Center / Partner Center submission, EV token/PIN workflow, and post-sign package reassembly not executed (and banned from this research ticket). |
| B3 | **HIGH** | **Build package contamination:** MSBuild output still includes `ComponentizedAudioSampleExtension.inf` + `sysvad.cat`. A careless submit from `x64\Release\package` would mix prohibited sample Extension + `sysvad.cat`. Staged folder is safe only if used exclusively. |

### Nits / non-blocking

| ID | Severity | Item |
|----|----------|------|
| N1 | Low | Binary/INF filenames remain sample names (`TabletAudioSample.sys`, `ComponentizedAudioSample.inf`). Functional OK; branding/cosmetic for HDC packaging. |
| N2 | Low | `SYSVAD_MIDI` residue in INF strings. |
| N3 | Low | Signatures not timestamped. |
| N4 | Low | Driver source heavily dirty vs microsoft/Windows-driver-samples; no TalkSync-owned remote branch snapshot documented. |
| N5 | Info | App docs treat driver signing as out-of-scope of Electron EV flow — intentional split. |
| N6 | Info | Ticket baseline `a28f851` vs current `31c9986` — isolation hard-gate already merged; no conflict for driver packaging research. |

---

## 10. Recommended minimal fix list (for implement phase)

Ordered for smallest path to attestation-ready **submit payload** (not full rebrand):

1. **Exclude Extension/APO INX from package**  
   Change `TabletAudioSample.vcxproj` Inf include to only `ComponentizedAudioSample.inx` (or explicitly exclude `ComponentizedAudioSampleExtension.inx` + Apo). Rebuild Release|x64 package; confirm output directory has **exactly** INF + SYS + `talksync.cat`.

2. **Freeze a submit folder**  
   Re-stage with manifest + SHA256 (same pattern as `package_user_facing_names_20260708`). Optionally rename folder/date. Do not ship Extension/sysvad.cat.

3. **Production sign (human gate)**  
   - EV-sign `TabletAudioSample.sys` (and any co-binaries if added later)  
   - Inf2Cat → `talksync.cat` over final INF+SYS set  
   - EV-sign catalog  
   - Prefer Authenticode timestamp  
   - Submit to **Microsoft Hardware Dev Center attestation** for kernel-mode MEDIA driver  
   - Replace package artifacts with Microsoft-signed returns  

4. **Optional cleanup before submit (nice-to-have, not required for B1)**  
   - Drop or rename `SYSVAD_MIDI` midi subclass if not needed  
   - Document DriverVer bump policy  
   - Snapshot TalkSync driver tree to a private git remote (preserve local mods)

5. **Do not change app feature code** for attestation; app already matches endpoint labels. Keep app EV installer signing separate (`docs/release/windows-code-signing.md`).

**Out of scope / banned for implement unless explicitly reopened:** EV PIN entry automation, live HDC submit from agent, pnputil/devcon install, bcdedit/testsigning flips on user machines as “proof”.

---

## 11. Build feasibility notes

| Topic | Note |
|-------|------|
| Prior build | `package_manifest.json` reports MSBuild Release\|x64 package **PASS**, Inf2Cat **no errors/warnings**, InfVerif talksync interface warning **not observed** |
| Toolchain | WDK km includes forced via untracked `Directory.Build.props` for `10.0.26100.0` — build machine dependent |
| Package project | `Inf2CatUseLocalTime=true` on Release\|x64; DriverSign FileDigestAlgorithm sha256 |
| Rebuild risk | Dirty source tree; rebuild may change SYS hash and require catalog regen before any signing |
| Architecture | NTamd64 targets for Win10 19041+ and 22621+; ARM64 configs exist but staged package is x64 SYS |
| Feasibility to attestation | **High for package composition** after Extension exclude; **medium/process-bound** for HDC account, EV token, and attestation turnaround |

---

## 12. Human-gate items

1. **EV code-signing certificate** available on a machine with token/PIN (agent must not handle PIN).
2. **Microsoft Partner Center / Hardware Dev Center** enrollment and attestation eligibility for this driver class.
3. Decision: **Attestation-only** (faster, product path preferred in MASTER_CONTEXT) vs full HLK/WHQL.
4. Confirm submit payload is the **filtered** triple (INF/SYS/CAT), never raw build dir with Extension.
5. Post-attestation: install test on clean non-testsigning Windows to verify **Code 52 gone**, then re-run app isolation hard-gate + Virtual Mic Tx path latency checks.
6. Preserve app dirty/untracked files listed in §1 when any later ticket commits only report docs.

---

## 13. Executive readiness summary

| Area | Result |
|------|--------|
| Product naming / HWID / service / endpoints | Ready |
| CatalogFile + staged package membership | Ready |
| Signature trust for end users | **Not ready** (WDKTestCert) |
| Build hygiene for safe packaging | **Partial** (Extension still built) |
| Overall | **PARTIAL** |

**Top blockers:** (1) EV + Microsoft attestation not applied, (2) HDC/human signing gate, (3) exclude Extension/`sysvad.cat` from build package so submit cannot be polluted.

**PASS aspects:** staged INF/SYS/CAT complete; `CatalogFile=talksync.cat`; `Root\talksync_TalkSyncAudio`; service `TalkSyncAudio`; friendly names match app exact-talksync binding.

---

## Appendix A — Commands used (read-only)

- App: `git status`, `git rev-parse HEAD`, `git rev-parse origin/main`, `git branch --show-current`
- Driver: `git rev-parse --show-toplevel`, `git status -sb`, `git log -1`
- Package: `certutil -hashfile … SHA256`, `Get-FileHash`, directory listings
- INF: UTF-16 content dump / Select-String field scan
- Sign: `signtool verify /pa /v` on SYS and CAT; `Get-AuthenticodeSignature`
- Content search: workspace Grep / PowerShell Select-String over app + driver trees

## Appendix B — Payload for coordinator

```text
role=research
verdict=PARTIAL
reportPath=docs/talksync/driver-attestation-research.md
filesModified=docs/talksync/driver-attestation-research.md
model=grok-4.5
```
