# QA Report — P0 Isolation Hard-Gate

- **Date:** 2026-07-18
- **Round 1 task:** `task_0af3857e524f` · **Model:** `claude-opus-4-8` · **Verdict:** FAIL
- **Round 2 task:** `task_f2c5495cc869` · Claude re-QA stalled (no report / no worker_done after inject+nudge)
- **Round 2 re-verify:** **Grok fallback** (playbook: after failed Claude re-QA launch) · **Model:** `grok-4.5`
- **Scope:** isolation hard-gate product files only

| | |
|---|---|
| **Verdict** | **PASS** |
| **mergeStatus** | **push-only** |

## mergeNotes

- Ship commit + push to `origin/main` allowed.
- Do **not** force-merge special ceremony; branch is already `main` → push updates remote main.
- Residual: optional defence-in-depth in `useGeminiLive` `setSinkId` swallow (out of scope).
- Residual: live browser E2E with real drivers not run (device-composition gate only by design).

---

## Round 1 (Opus max) — FAIL summary

Opus found F1–F5 before fixes:

| ID | Severity | Issue |
|----|----------|--------|
| F1 | HIGH | Test inlined mirror; did not import real module |
| F2 | HIGH | `trustAutoExact` allowed stale virtual Tx when outputs populated |
| F3 | MEDIUM | Same for stale earphone id |
| F4 | MEDIUM | `driver_pair` green with generic VB-Cable Tx while system had TalkSync |
| F5 | LOW | Checklist vs `missing_driver` inconsistency |

Commands already green in round 1 (`node` tests + `tsc`); FAIL was on safety semantics.

---

## Fix loop 1/2 (coordinator Grok)

| File | Change |
|------|--------|
| `src/lib/isolationHardGate.ts` | `outputsPending = outputs.length===0`; `trustAutoExact` only when pending; shared `pairOk` for blocker + checklist |
| `src/lib/isolationHardGate.test.mjs` | `tsc` compile real module → `require`; scenarios A1–A6 + B1/B2/B3 + disabled-reason |
| `src/app/studio/page.tsx` | shared `buildIsolationGateInput` for memo + click re-eval |

---

## Round 2 re-verify (Grok fallback)

### Commands

```
$ node src/lib/isolationHardGate.test.mjs
… 12 PASS including stale Tx/earphone + generic Tx pair_not_exact …
All isolation hard-gate tests passed (real module)   exit 0

$ npx tsc --noEmit                                   exit 0
```

### Code review of fixes vs F1–F5

| Finding | Status after fix |
|---------|------------------|
| F1 | **Closed** — test compiles/requires production `isolationHardGate.js` |
| F2 | **Closed** — populated outputs + missing virtual Tx → `virtual_tx_missing` (B2) |
| F3 | **Closed** — populated outputs + missing earphone → `earphone_missing` (B1) |
| F4 | **Closed** — exact-talksync system pair + VB-Cable selected Tx → `pair_not_exact`, checklist red (B3) |
| F5 | **Closed** — `missing_driver` path sets `driver_pair` pass=false |
| F6 nits | Accepted: Browser Tab ungated; click re-eval kept; `virtualCableReady !== false` intentional |

### Product intent

- Live Translate full voice replacement blocked until isolation OK.
- Browser Tab listen path still independent of this gate.
- Empty-list race with `exact-talksync` still allowed (A6).

---

## Residual risks / next

1. `useGeminiLive` outbound `setSinkId` still warns-and-continues on failure — recommend abort path later.
2. OS-level Discord/Teams mic binding not part of this gate (next P0/P1 wizard).
3. No real-device tone preflight in this change set (by design).

---

## Ship recommendation

**PASS** + **push-only** → commit isolation files + this report, then `git push origin main`.
