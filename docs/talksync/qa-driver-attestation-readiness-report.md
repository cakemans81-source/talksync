# QA — TalkSync Driver Attestation Readiness

**Ticket:** ORCA-TALKSYNC-DRIVER-ATTESTATION-READINESS-PIPELINE-1
**Role:** qa (independent)
**Date:** 2026-07-18
**Model:** claude-opus-4-8
**Mode:** read-only verification (no fix required; nothing modified outside this report)

## Verdict: PASS

Submit-shape package membership, INF product identity, B3 packaging fix, doc accuracy, script safety, and the hard bans all verify. Findings below are non-blocking robustness/provenance defects in the **helper script and surrounding hygiene**, not in the staged package that a human would submit.

## mergeStatus: push-only

## mergeNotes

Push to `main` without merge-gating: this pass adds **driver documentation + one optional PowerShell helper** and touches no application runtime code. `git status` confirms zero changes under `src/` — the only tracked modification in the app repo (`docs/qa-isolation-hard-gate-report.md`) predates this ticket. Nothing here changes app behavior, so there is no runtime regression surface to gate on.

Do **not** treat the push as attestation progress. Code 52 is **not** cleared: `signtool verify /pa /v` still reports `WDKTestCert user,134189977194030591` (self-issued) on both SYS and CAT. B1 (EV signing) and B2 (Hardware Dev Center attestation) remain human-only gates and were not executed.

Stage **explicitly, not with `git add -A`**. The working tree carries unrelated untracked material (`.codex/`, `scratch/`, `UpdateAudioDriver.bat`, `docs/MASTER_CONTEXT.md`, `docs/project-structure-report.md`). Stage only:

```
docs/talksync/driver-attestation-readiness.md
docs/talksync/driver-attestation-submission-checklist.md
docs/talksync/driver-attestation-research.md
docs/talksync/smoke-driver-attestation-package.md
docs/talksync/qa-driver-attestation-readiness-report.md
scripts/driver/prepare-attestation-package.ps1
```

No `.sys` / `.cat` / `.inf` binaries may enter the app repo; the staged package correctly lives outside it. The `TabletAudioSample.vcxproj` B3 fix is in the Microsoft samples tree (a separate repo) and is intentionally left uncommitted there.

Recommend addressing **M1** and **M2** before a human uses the helper for a real submission run.

---

## Verification results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | Package = exactly INF + SYS + `talksync.cat` (+manifest/hashes) | **PASS** | 5 files; no Extension INF, no `sysvad.cat`, no APO INF |
| 2 | INF identity fields | **PASS** | All 6 fields verified on stamped INF (UTF-16LE) |
| 3 | B3 fix in vcxproj; rebuild not contaminated | **PASS** | Line 326 matches doc; `x64\Release\package` clean |
| 4 | Docs accurate; human gates separated; no "Code 52 fixed" claim | **PASS** | 13 Code-52 references, all correctly framed as blocked |
| 5 | Script does not EV-sign / install / submit | **PASS** | Static audit **and** live execution |
| 6 | App `src/` / Electron product code untouched | **PASS** | `git status` — no `src/` entries |
| 7 | No secrets/PIN in docs; staging guidance | **PASS** / gap → **L1** | Only prohibition text; zero credential material |
| 8 | certutil hashes + signtool verify | **PASS** | Hashes match docs byte-for-byte; WDKTestCert as expected |
| 9 | EV / PIN / HDC / install unexecuted | **PASS** | Test-cert signature is positive proof EV never ran |

### 1 — Package membership

`C:\Users\user\Desktop\TalkSync_Driver\package_attestation_ready_20260718`

| File | Size | Role |
|------|-----:|------|
| `ComponentizedAudioSample.inf` | 13346 | base INF |
| `TabletAudioSample.sys` | 101936 | kernel driver |
| `talksync.cat` | 3980 | catalog |
| `package_manifest.json` | 4165 | aux metadata |
| `hashes.txt` | 280 | aux digests |

Absent as required: `ComponentizedAudioSampleExtension.inf`, `ComponentizedApoSample.inf`, `sysvad.cat`.

### 2 — INF product identity

INF is UTF-16LE (BOM `FF FE`) — plain byte-oriented grep returns nothing on this file; read via encoding-aware tooling.

| Field | Expected | Actual | Line |
|-------|----------|--------|-----:|
| CatalogFile | `talksync.cat` | `talksync.cat` | 7 |
| Hardware ID | `Root\talksync_TalkSyncAudio` | `Root\talksync_TalkSyncAudio` | 26, 29 |
| Service | `TalkSyncAudio` | `AddService = TalkSyncAudio` | 56 |
| Render endpoint | `TalkSync Virtual Speaker (Rx)` | exact match | 140 |
| Capture endpoint | `TalkSync Virtual Microphone (Tx)` | exact match | 142 |
| Class / Provider | MEDIA / TalkSync | `Class = MEDIA`, `ProviderName = "TalkSync"` | 3, 135 |

**Category wiring verified correct** (this is the check that matters, not just string presence):

- `KSCATEGORY_RENDER` → `WaveTalkSyncTx` → FriendlyName **"TalkSync Virtual Speaker (Rx)"** — a speaker is a render endpoint ✓
- `KSCATEGORY_CAPTURE` → `WaveTalkSyncRx` → FriendlyName **"TalkSync Virtual Microphone (Tx)"** — a microphone is a capture endpoint ✓

**End-to-end consistency with the app confirmed.** `src/lib/audioDeviceBinding.ts` matches on lowercased substrings: `isTalkSyncSpeakerRx` requires `audiooutput` + `talksync` + (`speaker` | standalone `rx`); `isTalkSyncMicrophoneTx` requires `audioinput` + `talksync` + (`microphone` | `mic` | standalone `tx`). Both INF names satisfy their matcher. The UI copy renders `Speaker(Rx)` without a space, but that string is display text only and never a match key — no defect.

### 3 — B3 fix and build cleanliness

`TabletAudioSample.vcxproj:326` — exactly as documented:

```xml
<Inf Exclude="@(Inx);ComponentizedAudioSampleExtension.inx;ComponentizedApoSample.inx" Include="ComponentizedAudioSample.inx" />
```

The exclusion does real work: all three `.inx` sources still exist on disk, so the filter — not file deletion — is what keeps the package clean.

`x64\Release\package` contains only `ComponentizedAudioSample.inf`, `TabletAudioSample.sys`, `talksync.cat`. **Uncontaminated.**

### 8 — Independent hash and signature verification

`certutil -hashfile … SHA256` reproduced all three digests exactly as recorded in `driver-attestation-readiness.md` §5, `hashes.txt`, and `package_manifest.json`:

```
ComponentizedAudioSample.inf  32be651ee2dca164ed8a433435c28f0df1905aac449beea25e28ef34c2a17363
TabletAudioSample.sys         5ca08b82e1ecba7fc11cdca9de64ba1dcf3c2136a2f6b42d5f935604c1d922e2
talksync.cat                  d8cbe962010ba5477b49397377ddb8b1cae50b2166d2de6fb432437a6a2f09f6
```

`signtool verify /pa /v` (`Windows Kits\10\bin\10.0.26100.0\x64`) — both SYS and CAT: *Successfully verified*, 0 errors, 0 warnings. Signer **`WDKTestCert user,134189977194030591`**, self-issued, expires 2036-03-26, **not timestamped**. This is the expected pre-B1 state and is direct evidence that EV signing was never performed.

---

## Findings by severity

No BLOCKER or HIGH findings. B1/B2 remain open by design, correctly documented as human gates.

### MEDIUM

**M1 — `prepare-attestation-package.ps1` destroys its input when `SourcePackageDir == DestDir`**

The cleanup loop (lines 63–69) deletes the required filenames from `$DestDir` *before* the copy loop (lines 71–73) reads them from `$SourcePackageDir`. When both resolve to the same directory, the script deletes the triple and then fails trying to copy files it just removed. The pre-flight existence check (lines 54–59) runs before the delete and therefore does not protect against this.

Confirmed empirically in an isolated sandbox with dummy files (the real package was never used as a target):

```
BEFORE: ComponentizedAudioSample.inf, TabletAudioSample.sys, talksync.cat
THREW : Cannot find path '…\ComponentizedAudioSample.inf' because it does not exist.
AFTER : <EMPTY - FILES DESTROYED>
```

Impact: an operator running "restage in place" loses the build output (regenerable via rebuild, so data loss is bounded — but it is silent, mid-run, and the error message misleadingly blames a missing source file). Fix: compare resolved full paths and fail fast, or copy to a temp dir and swap.

**M2 — Prohibited-file check guards only the destination, never the source**

`$prohibited` is enforced against `$DestDir` after copying (lines 76–80). Because the script copies only the three whitelisted names, a **contaminated or Debug source always yields a clean dest** and reports `PASS: filtered package ready`. There is no assertion that the source is a Release build or free of Extension/APO/`sysvad.cat` artifacts.

This is live, not hypothetical: on this machine `x64\Debug\package` currently contains `ComponentizedAudioSampleExtension.inf`, `sysvad.cat`, **and** `talksync.cat`. Pointing the helper at that directory would stage a **Debug-built driver** for attestation submission and print PASS. Fix: warn or fail if `$SourcePackageDir` contains any prohibited name; assert the path resolves under a Release output.

**M3 — Staged `package_manifest.json` is not reproducible from the committed script**

The checklist (A3) states the helper writes the manifest, and readiness §3 lists it as staged output. Executing the committed script against the same source produces a **2888-byte** manifest, while the staged file is **4165 bytes** and carries fields the script never emits: `ticket`, `phase`, `source_root`, `b3_fix`, `endpoint_names`, `build_result`, `prohibited_actions_not_performed`, `residual_blockers`. The `talksync.cat` role also differs (`catalog` in script output vs `catalog_wdktestcert_signed_dev_only` in the staged file).

The staged manifest was therefore hand-authored, not generated. Its *content* is accurate — every field cross-checks against my independent measurements — but the documented reproduction path does not regenerate it, so a re-stage before HDC submit would silently drop the build/ticket provenance. Fix: either extend the script to emit those fields (e.g. via a `-Notes`/`-Ticket` parameter) or state in the docs that provenance fields are added manually.

**M4 — Local driver validation is disabled, deferring failures to Microsoft**

`TabletAudioSample.vcxproj` carries `ApiValidator_Enable=false` and `InfVerif_NeedsValidation=false` (both Release and Debug), plus `/FORCE:MULTIPLE /ignore:4210` on the Release x64 link. These predate this ticket and are correctly out of its scope, but they disable precisely the checks Microsoft re-runs server-side during attestation. Combined with the known `InfVerif.dll` load failure recorded in readiness §4, **no InfVerif pass has actually succeeded locally** — a rejection at B2 would be the first signal. `/FORCE:MULTIPLE` suppressing duplicate symbols in a kernel-mode binary is additionally worth a deliberate human decision before submission. Recommend running InfVerif/ApiValidator standalone against the staged INF/SYS before spending an HDC submission cycle.

### LOW

**L1 — No git staging guidance despite a dirty working tree.** The docs never state how to stage, and the repo carries untracked material unrelated to this ticket (`.codex/`, `scratch/`, `UpdateAudioDriver.bat`, `docs/MASTER_CONTEXT.md`, `docs/project-structure-report.md`). A reflexive `git add -A` would commit all of it. Explicit paths are listed in **mergeNotes** above.

**L2 — INF token naming is inverted relative to display suffixes.** `WaveTalkSyncTx` carries the `(Rx)` name and `WaveTalkSyncRx` carries the `(Tx)` name; same inversion in `TalkSync Tx Topology` (render) / `TalkSync Rx Topology` (capture). **Functionally correct** — categories and friendly names are right, and the app matches them — but the internal naming invites a future edit to "fix" the wrong side and actually break endpoint routing. Cosmetic, pre-existing, out of scope; worth a source comment.

**L3 — Doc understates driver-tree dirtiness.** Readiness §2 says the vcxproj change is "left uncommitted … (dirty local TalkSync work)". The samples tree actually has **43** dirty entries, including `minwavert.cpp`, `minwavertstream.cpp`, `ComponentizedAudioSample.inx`, `package.VcxProj`, and untracked `talksync_*.cpp/h`. All are pre-existing TalkSync customizations, not this ticket's work, but the singular phrasing could lead someone to assume a one-file diff and commit far more than intended.

**L4 — Stale-directory warning omits the Debug path.** Readiness §4 warns only about `x64\Release\package`. The contaminated directory on this machine is `x64\Debug\package`. Pairs with **M2**.

**L5 — Dev signatures are untimestamped.** Expected for WDKTestCert and already noted by the smoke pass; carried here only so the B1 checklist item ("prefer Authenticode timestamp") is not dropped.

---

## Hard bans — confirmed unexecuted

| Banned action | Status | How confirmed |
|---|---|---|
| EV signing / PIN entry | **not performed** | `signtool` still reports WDKTestCert on SYS + CAT |
| Hardware Dev Center submit / download | **not performed** | No network or HDC tooling invoked |
| Driver install/remove (`pnputil`, `devcon`) | **not performed** | Read-only inspection only |
| `bcdedit` / Test Mode / Secure Boot | **not performed** | Untouched |
| App product code changes | **not performed** | `git status` shows no `src/` modifications |
| `.sys` / `.cat` committed to app repo | **not performed** | Package lives outside the repo |

QA side effects: two throwaway directories under the session scratchpad (`pkgtest_normal`, `pkgtest_samedir`). The real package, the build output, and the app repo were never written to. The only file this pass created is this report.

## Files reviewed

- `docs/talksync/driver-attestation-research.md`
- `docs/talksync/driver-attestation-readiness.md`
- `docs/talksync/driver-attestation-submission-checklist.md`
- `docs/talksync/smoke-driver-attestation-package.md`
- `scripts/driver/prepare-attestation-package.ps1`
- `TabletAudioSample.vcxproj` (samples tree, read-only)
- `package_attestation_ready_20260718\` (staged triple + manifest + hashes)
- `x64\Release\package\`, `x64\Debug\package\` (build outputs)
- `src/lib/audioDeviceBinding.ts`, `src/lib/isolationHardGate.ts` (read-only cross-check)

## Coordinator payload

```text
role=qa
verdict=PASS
mergeStatus=push-only
model=claude-opus-4-8
reportPath=docs/talksync/qa-driver-attestation-readiness-report.md
filesModified=docs/talksync/qa-driver-attestation-readiness-report.md
findings=0 blocker, 0 high, 4 medium (M1 script same-dir data loss, M2 source not validated, M3 manifest not reproducible, M4 local validation disabled), 5 low
bansHeld=EV/PIN/HDC/install all unexecuted — WDKTestCert signature is positive proof
```
