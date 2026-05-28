# Vyotiq Code Review Audit Report

**Workspace:** `c:\Users\admin\Documents\vyotiq`  
**Audit date:** 2026-05-28  
**Scope:** ~354 changed paths (staged + unstaged + untracked treated in-scope; layer labeled per finding where detectable)  
**Constraint:** Read-only on application code; this file is the only write.

---

## 1. Executive summary

| Severity | Count | Representative themes |
|----------|------:|------------------------|
| **Critical** | 3 | Transcript loss on disk errors; delegation crash on mid-pool abort; failed `startRun` skips append drain |
| **High** | 7 | Supersede can hang forever; UI overlay stacking; tool re-run trust boundary; persist-failure signal gap |
| **Medium** | 11 | Perf (timeline fold, streaming MD); harness/parser drift; duplicate diff/subagent surfaces; a11y gaps |
| **Low** | 6 | Dead exports, unused helpers, knip/font noise |
| **Mechanical** | — | See §7 (knip/EOF/dead files; not scored as behavioral severity) |

### Top 3 risks

1. **AUD-C02 — Silent transcript loss:** `appendEvent` logs disk failures but resolves successfully; `chat.ipc`’s `persistFailureMessage` path does not reliably fire, so the UI can show `CHAT_DONE` while JSONL is missing tail events.
2. **AUD-C01 — Delegation crash on abort:** `SubAgentPool` can return a sparse `results` array when the pool signal aborts while workers are queued; `handleDelegates` immediately `runs.map(...)` and dereferences `run.output` → runtime throw during Stop/supersede.
3. **AUD-C03 — Failed run settlement:** `startRun(...).catch` settles the latch and emits `CHAT_ERROR` but never `drainAppendChain`, unlike `onDone`/`onError`; a follow-up send can read a truncated transcript.

### Verification snapshot (2026-05-28)

| Command | Result |
|---------|--------|
| `npm run typecheck` | **Pass** (node + web `tsc --noEmit`) |
| `npm run knip` | **Pass** (exit 0; 5 configuration hints only) |
| `git diff --check` | **Pass** (no trailing-space/EOF conflicts reported) |
| `npx vitest run tests/main/orchestrator/loop/handleDelegates.test.ts tests/main/orchestrator/parseDelegates.test.ts` | **51/51 passed** |
| `npx vitest run tests/main/orchestrator/SubAgentPool.test.ts` | **2/2 passed** (does not assert filled result slots) |

User-reported full build green; typecheck/knip align. No orchestrator tests under `src/main/orchestrator/` path filter (tests live in `tests/main/orchestrator/`).

---

## 2. Evidence methodology

1. **Prior recon synthesis** — Phase 1–5 bullets from parent agent were treated as hypotheses, not facts.
2. **File verification** — Every cited line range was read from the working tree (mixed **staged (A/M)**, **unstaged (M/??)**, **untracked** per `git status` snapshot at audit start).
3. **Commands** — `npm run typecheck`, `npm run knip`, `git diff --check`, targeted vitest (above). `knip-fresh.json` in repo root was compared to `npm run knip` (current knip is clean; fresh JSON documents stricter unused-file findings for cleanup).
4. **Layer labeling** — Findings note `staged`, `unstaged`, or `untracked` when the path’s git status was obvious from the snapshot; many paths are simultaneously modified in multiple layers after partial staging.

**Tailwind v4 note (UI):** Redesign uses semantic tokens in `src/renderer/index.css` (`@theme`, `--text-row`, `--color-text-primary`, etc.). UI findings reference those tokens, not legacy `styles/tokens.css`.

---

## 3. Findings

### Critical

#### AUD-C01 — Sparse `SubAgentPool` results crash `handleDelegates` on abort

| Field | Detail |
|-------|--------|
| **Severity** | Critical (crash during Stop/supersede) |
| **Evidence** | `SubAgentPool.ts:49-52` workers `return` when `deps.signal.aborted` without assigning `results[next]`; `SubAgentPool.test.ts:70-99` aborts with only worker `A` started but expects `runs.length === 3` without checking slots; `handleDelegates.ts:570-576` `runs.map((run) => verifySubagentRun(run.output, ...))` |
| **Impact** | Mid-delegation abort leaves `undefined` entries; next line throws (`Cannot read properties of undefined`). Orchestrator run dies; partial transcript may already be persisted. |
| **Root cause** | Abort is modeled as early worker exit, not as per-spec placeholder runs. |
| **Recommended fix** | On abort exit (and after `Promise.all`), `fillMissingResults(specs, results, signal)` with `{ status: 'aborted', output: '', ... }` per vacant index, or filter holes before `map`. |
| **Affected files** | `src/main/orchestrator/SubAgentPool.ts`, `src/main/orchestrator/loop/handleDelegates.ts`, `tests/main/orchestrator/SubAgentPool.test.ts` |
| **Implementation sequence** | 1) Add hole-filler after pool completes. 2) Assert every slot defined in pool test. 3) Add `handleDelegates` test with aborted pool mock returning sparse array (regression). |
| **Regression test target** | `tests/main/orchestrator/SubAgentPool.test.ts` + new case in `handleDelegates.test.ts` |
| **Verification** | `npx vitest run tests/main/orchestrator/SubAgentPool.test.ts tests/main/orchestrator/loop/handleDelegates.test.ts` |

**Git layer:** `M` staged/unstaged orchestrator paths.

---

#### AUD-C02 — `appendEvent` swallows disk failures; callers assume durability

| Field | Detail |
|-------|--------|
| **Severity** | Critical (silent data loss) |
| **Evidence** | `conversationStore.ts:553-570` catch logs and does not rethrow; `conversationStore.ts:597-609` `drainAppendChain` resolves even when append failed; `chat.ipc.ts:562-569` `persistEvent` `.catch` sets `persistFailureMessage` only if `appendEvent` rejects (inner failures never reject) |
| **Impact** | Renderer receives streamed events via `safeSend`, but JSONL omits them; reload/replay/supersede sees truncated history; `eventCount` meta may not bump (ordering fix at 475-479 is correct, but loss remains). |
| **Root cause** | Durability errors treated as log-only inside the per-conversation chain. |
| **Recommended fix** | Propagate failure: rethrow after log, or return `Result`/`{ ok: false }` and teach `drainAppendChain`/`persistEvent` to set `persistFailureMessage` and optionally block `CHAT_DONE`. |
| **Affected files** | `src/main/conversations/conversationStore.ts`, `src/main/ipc/chat.ipc.ts`, `src/main/ipc/toolRerun.ts` (same fire-and-forget pattern at 29-31) |
| **Implementation sequence** | 1) Make failed append reject the chain tail. 2) Wire `persistFailureMessage` on rejection. 3) Audit other `appendEvent().catch` call sites. |
| **Regression test target** | New test mocking `fs.appendFile` EACCES/EBUSY in `tests/main/conversations/` |
| **Verification** | Vitest conversation store tests + manual: induce disk full / read-only transcript dir |

**Git layer:** `M` `conversationStore.ts`, `chat.ipc.ts`.

---

#### AUD-C03 — `startRun` rejection path skips `drainAppendChain`

| Field | Detail |
|-------|--------|
| **Severity** | Critical (silent halt / corrupt next turn) |
| **Evidence** | `chat.ipc.ts:891-916` `onDone` → `flushAll` → `drainAppendChain` → `settleRun`; `chat.ipc.ts:933-939` `.catch` calls `flushAll`, `settleRun`, `CHAT_ERROR` but **no** `drainAppendChain`; `chat.ipc.ts:303-304` supersede awaits settlement then drain |
| **Impact** | If `startRun` throws before normal terminal callbacks, settlement latch opens while append chain may still hold coalesced deltas; next `chat:send` reads incomplete JSONL → orchestrator amnesia. |
| **Root cause** | Error path added without mirroring durability contract of `onDone`/`onError`. |
| **Recommended fix** | Extract shared `finalizeRunDurability(cid, { error })` used by `onDone`, `onError`, and `.catch`. |
| **Affected files** | `src/main/ipc/chat.ipc.ts` |
| **Implementation sequence** | 1) Factor finalizer. 2) Call from `.catch`. 3) IPC test: mock `startRun` throw, assert drain awaited before `settleRun`. |
| **Regression test target** | `tests/main/ipc/` or orchestrator integration harness |
| **Verification** | Vitest + manual supersede after forced `startRun` failure |

**Git layer:** `M` `chat.ipc.ts`.

---

### High

#### AUD-H01 — `awaitRunSettlement` has no timeout

| Field | Detail |
|-------|--------|
| **Severity** | High (wrong behavior — supersede hang) |
| **Evidence** | `runSettlement.ts:31-35` awaits `slot.promise` indefinitely; `chat.ipc.ts:303` supersede path awaits before new run |
| **Impact** | If prior run never calls `settleRun` (crash, hung promise, missing terminal handler), new message blocks forever in `chat:send`. |
| **Root cause** | Settlement latch is trust-based with no watchdog. |
| **Recommended fix** | `Promise.race` with configurable timeout + log; on timeout, force `drainAppendChain` and abort stale `runId`s. |
| **Affected files** | `src/main/ipc/runSettlement.ts`, `src/main/ipc/chat.ipc.ts` |
| **Implementation sequence** | 1) Add timeout constant. 2) Log metric on timeout. 3) Test supersede when `settleRun` never called. |
| **Regression test target** | New `runSettlement.test.ts` |
| **Verification** | `npx vitest run tests/main/ipc/runSettlement.test.ts` (after add) |

**Git layer:** `A`/`??` `runSettlement.ts`, `M` `chat.ipc.ts`.

---

#### AUD-H02 — `persistFailureMessage` ineffective for internal append failures

| Field | Detail |
|-------|--------|
| **Severity** | High (state corruption — UI/run state diverges from disk) |
| **Evidence** | Same as AUD-C02; `chat.ipc.ts:906-914` only surfaces `persistFailureMessage` on done path |
| **Impact** | User sees success while persistence failed; overlaps C02 but emphasizes UX false-negative. |
| **Root cause** | Error signaling wired to Promise rejection, not append outcome. |
| **Recommended fix** | Same as C02; ensure `CHAT_DONE` becomes `CHAT_ERROR` when any persist in run failed. |
| **Affected files** | `chat.ipc.ts`, `conversationStore.ts` |
| **Implementation sequence** | Shared with C02. |
| **Regression test target** | Chat IPC unit test with mocked failing append |
| **Verification** | Vitest |

**Git layer:** `M`.

---

#### AUD-H03 — Overlay z-index: App backdrop `z-[59]` under FloatingPanel `z-[60]` but competes with composer approvals

| Field | Detail |
|-------|--------|
| **Severity** | High (wrong UX — clicks/focus on hidden approvals) |
| **Evidence** | `App.tsx:473-481` shared backdrop `z-[59]`; `FloatingPanel.tsx:146` root `z-[60]`; `EditApprovalDialog.tsx` uses `ComposerDialogPortal` (no elevated z-index in `ComposerDialog.tsx:198-209`); plan called for bottom-sheet confirmations above chat |
| **Impact** | Agent trace / attachment preview / live diff panels can cover strict-approval dialogs portaled into the composer anchor; user may think the app froze. Tailwind v4 tokens: backdrop uses raw `bg-black/40`, not semantic overlay token. |
| **Root cause** | Multiple overlay systems (app backdrop, floating panels, composer portal) without a single z-index scale. |
| **Recommended fix** | Define `--z-overlay-confirm` > `--z-floating-panel` in `index.css`; portal approvals to `document.body` at top z-index when any floating panel is open, or pause floating panels while `ConfirmHost` queue non-empty. |
| **Affected files** | `App.tsx`, `FloatingPanel.tsx`, `ConfirmHost.tsx`, `ComposerDialogAnchor.tsx`, `index.css` |
| **Implementation sequence** | 1) Document z-order table. 2) Raise confirm layer. 3) Manual: open edit approval + Agent trace panel. |
| **Regression test target** | `tests/renderer/` visual or Playwright overlay click test |
| **Verification** | Manual smoke; optional `control-ui` skill harness |

**Git layer:** `M`/`??` renderer shell files.

---

#### AUD-H04 — `toolRerun` executes `bash` outside orchestrator policy with minimal IPC gate

| Field | Detail |
|-------|--------|
| **Severity** | High (wrong behavior / expanded blast radius) |
| **Evidence** | `toolRerun.ts:8-14` allows `bash`; `tools.ipc.ts:96-102` validates shape only; `executeToolRerun` uses `runToolByName` with `runId: rerun:${callId}` — no active-run registry, no orchestrator tool allowlist |
| **Impact** | Renderer can re-run destructive shell from timeline UI without an orchestrator turn; bypasses delegation narrative and complicates audit attribution. |
| **Root cause** | Re-run feature reused full tool runner without role/orchestrator boundary. |
| **Recommended fix** | Drop `bash` from `RERUN_ALLOWED_TOOLS`, or require read-only tools only; optionally require matching original `tool-call` event id and role check. |
| **Affected files** | `src/shared/tools/toolRerun.ts`, `src/main/ipc/toolRerun.ts`, `tools.ipc.ts` |
| **Implementation sequence** | 1) Tighten allowlist. 2) Align renderer buttons. 3) Test rerun rejected for bash. |
| **Regression test target** | `tests/shared/tools/toolRerun.test.ts` (add if missing) |
| **Verification** | `npx vitest run tests/shared/tools/` |

**Git layer:** `??` `toolRerun.ts` (main), shared types.

---

#### AUD-H05 — Dual sub-agent surfaces (timeline batch + `AgentTracePanel`)

| Field | Detail |
|-------|--------|
| **Severity** | High (wrong UX / inconsistent state) |
| **Evidence** | Plan `complete-redesign.md:51-53` “Remove timeline trace”; `deriveRows.ts` still emits `subagent-line`; `AgentTracePanel.tsx` + `SubAgentRunFlow.tsx` duplicate fold logic (`deriveRows` comment at 173); `projectSubagentRows.ts` merges lines into `delegate-batch` |
| **Impact** | Users see dock peek + timeline chips + floating trace; expanded trace rebuilds flow separately from timeline reducer — risk of drift (tool grouping already centralized in `groupTools.ts` but flow builder is parallel). |
| **Root cause** | Partial migration: backend events still drive timeline rows while UX moved to panel. |
| **Recommended fix** | Complete Phase 6: stop emitting or rendering `subagent-line` when trace panel is canonical; single source for expanded trace data. |
| **Affected files** | `deriveRows.ts`, `Timeline.tsx`, `AgentTracePanel.tsx`, `SubAgentRunFlow.tsx` |
| **Implementation sequence** | 1) Feature-flag timeline subagent rows off. 2) Ensure panel covers all events. 3) Delete duplicate fold. |
| **Regression test target** | `tests/renderer/timeline/timelineDelegateBatch.test.tsx` |
| **Verification** | Vitest renderer + manual delegation round |

**Git layer:** `??` agent trace tree; `M` timeline.

---

#### AUD-H06 — Parallel diff implementations (checkpoint consolidation incomplete)

| Field | Detail |
|-------|--------|
| **Severity** | High (wrong behavior risk — divergent diff UX/rules) |
| **Evidence** | `DiffViewer.tsx`, `PendingChangeDiff.tsx`, `ReviewDiffViewer.tsx`, `EditDiffView.tsx`, `UnifiedDiffPanel.tsx` coexist; plan Phase 5 “Single DiffViewer” |
| **Impact** | Encoding, layout toggle, copy affordances may differ per surface; fixes must be applied N times. |
| **Root cause** | Incremental redesign landed new component without retiring old paths. |
| **Recommended fix** | Route pending/review/edit/live-diff through `DiffViewer` + shared props; delete thin wrappers. |
| **Affected files** | `src/renderer/components/diff/*`, `checkpoints/*`, `timeline/tools/edit/*` |
| **Implementation sequence** | 1) Inventory props. 2) Adapter layer. 3) Remove duplicates. |
| **Regression test target** | Renderer snapshot tests on one canonical diff |
| **Verification** | Vitest + checkpoints manual pass |

**Git layer:** `??` diff folder; `M` checkpoints.

---

#### AUD-H07 — `malformedOpeners` parser slot is dead code

| Field | Detail |
|-------|--------|
| **Severity** | High (wrong behavior — model never told about malformed delegate XML) |
| **Evidence** | `parseDelegates.ts:82-92` `malformedOpeners` always `[]`; `runLoop.ts:1275-1285` phase emit guarded on `length > 0` — never runs |
| **Impact** | Malformed `<delegate` tags that fail regex silently skipped; orchestrator loses harness-promised breadcrumb. |
| **Root cause** | Feature stubbed but not implemented. |
| **Recommended fix** | Detect opener tokens that fail `DELEGATE_RE` and push snippets into `malformedOpeners`. |
| **Affected files** | `src/shared/text/parseDelegates.ts`, `runLoop.ts` |
| **Implementation sequence** | 1) Implement detection. 2) Tests in `parseDelegates.test.ts`. 3) Verify phase event. |
| **Regression test target** | `tests/main/orchestrator/parseDelegates.test.ts` |
| **Verification** | `npx vitest run tests/main/orchestrator/parseDelegates.test.ts` |

**Git layer:** `M` shared + orchestrator.

---

### Medium

#### AUD-M01 — No transcript virtualization; full `deriveRows` on every event

| Field | Detail |
|-------|--------|
| **Severity** | Medium (performance) |
| **Evidence** | `Timeline.tsx:141-159` `useMemo(() => deriveRows(events, ...), [events, ...])` — entire transcript refold on any event change |
| **Impact** | Long sessions → UI jank, high RAM (plan Phase 7 RAM item). |
| **Root cause** | Correctness-first reducer without incremental fold or windowing. |
| **Recommended fix** | Incremental derive keyed by last event id, or virtual list with stable row keys. |
| **Affected files** | `Timeline.tsx`, `deriveRows.ts` |
| **Implementation sequence** | 1) Profile. 2) Incremental cache. 3) Virtualizer. |
| **Regression test target** | Perf benchmark or large fixture test |
| **Verification** | Manual 5k-event transcript; optional profiler |

**Git layer:** `M` renderer.

---

#### AUD-M02 — Streaming markdown still reparses full body each delta (mitigated, not eliminated)

| Field | Detail |
|-------|--------|
| **Severity** | Medium (performance) |
| **Evidence** | `MarkdownBody.tsx:96-111` memo on `sanitizedText` — still O(n) rehype per change while streaming; `StreamingMarkdownBody.tsx` switches to full GFM when done |
| **Impact** | Long assistant messages stutter during token stream. |
| **Root cause** | react-markdown + highlight is whole-document. |
| **Recommended fix** | Keep lightweight stream renderer until idle; throttle highlight pass. |
| **Affected files** | `MarkdownBody.tsx`, `StreamingMarkdownBody.tsx` |
| **Implementation sequence** | 1) Throttle. 2) Chunk hash cache. |
| **Regression test target** | Renderer perf test |
| **Verification** | Manual long code block stream |

**Git layer:** `M`.

---

#### AUD-M03 — `FloatingPanel` lacks focus trap and initial focus

| Field | Detail |
|-------|--------|
| **Severity** | Medium (accessibility) |
| **Evidence** | `FloatingPanel.tsx:91-101` Escape only; `role="dialog"` + `aria-modal="true"` at 157-158; no `focus-trap` or `autoFocus` |
| **Impact** | Keyboard users tab behind panel/backdrop; WCAG dialog pattern incomplete. |
| **Root cause** | Visual overlay first implementation. |
| **Recommended fix** | `focus-trap-react` or manual trap; focus first focusable on open. |
| **Affected files** | `FloatingPanel.tsx` |
| **Implementation sequence** | 1) Trap. 2) Restore focus on close. 3) a11y test. |
| **Regression test target** | axe or Playwright |
| **Verification** | Manual Tab cycle |

**Git layer:** `??` `FloatingPanel.tsx`.

---

#### AUD-M04 — Duplicate `aria-modal` trees (panel + `ComposerDialog`)

| Field | Detail |
|-------|--------|
| **Severity** | Medium (accessibility) |
| **Evidence** | `FloatingPanel.tsx:158`; `ComposerDialog.tsx:202` |
| **Impact** | Screen readers may announce nested modals incorrectly when both open. |
| **Root cause** | Composer dialogs not promoted to shared modal primitive. |
| **Recommended fix** | Single modal primitive; `aria-hidden` on chat main when any modal open. |
| **Affected files** | `FloatingPanel.tsx`, `ComposerDialog.tsx`, `ConfirmHost.tsx` |
| **Implementation sequence** | 1) Audit open combinations. 2) Unify. |
| **Regression test target** | a11y snapshot |
| **Verification** | NVDA/VoiceOver spot check |

**Git layer:** `M`/`??`.

---

#### AUD-M05 — Harness worked example uses Python layout in generic codebase

| Field | Detail |
|-------|--------|
| **Severity** | Medium (maintainability / model confusion) |
| **Evidence** | `00-prime-directives.md:54-58` Python paths (`main.py`, `tools/bash.py`) while Vyotiq is TypeScript/Electron |
| **Impact** | Models may hallucinate Python paths in TS repos (already seen in comments in `handleDelegates.ts:158-159`). |
| **Root cause** | Example copied from archetype project. |
| **Recommended fix** | Rewrite worked example with `src/main/`, `src/renderer/`, `package.json`. |
| **Affected files** | `src/main/harness/00-prime-directives.md` |
| **Implementation sequence** | 1) Replace paths. 2) Sync with `orchestratorTools.ts` comment block. |
| **Regression test target** | None (docs) |
| **Verification** | Manual harness diff review |

**Git layer:** `M` harness.

---

#### AUD-M06 — Sub-agent harness “no memory” vs `memory` in `SUBAGENT_FULL_TOOLS`

| Field | Detail |
|-------|--------|
| **Severity** | Medium (maintainability) |
| **Evidence** | `04-subagent-prompt.md:5-6` “no memory of prior turns”; `subagentTools.ts:36-44` includes `memory` in full toolset |
| **Impact** | Wording conflates conversation memory with `memory` tool; models may avoid a valid tool. |
| **Root cause** | Different meanings of “memory”. |
| **Recommended fix** | Clarify: “no transcript recall” vs tool name; rename tool in docs if needed. |
| **Affected files** | Harness `04-subagent-prompt.md`, `subagentTools.ts` |
| **Implementation sequence** | 1) Doc pass. |
| **Regression test target** | None |
| **Verification** | N/A |

**Git layer:** `M`.

---

#### AUD-M07 — Verifier structural-only vs harness semantic acceptance

| Field | Detail |
|-------|--------|
| **Severity** | Medium (wrong verification signal) |
| **Evidence** | `verifier.ts:1-10` documents cheap structural checks; harness `04-subagent-prompt.md:74-79` verification mindset; orchestrator LLM still must verify |
| **Impact** | `partial`/`success` structural `ok` can count as non-failure for strikes while semantic task failed (partial resets `consecutiveBadRounds` per `handleDelegates.ts:586-596` + harness `01-orchestration-loop.md:463-465`). |
| **Root cause** | By design, but easy to misread in triage. |
| **Recommended fix** | Surface structural vs semantic in `subagent-status` UI; optional stricter strike for `partial` when all siblings failed. |
| **Affected files** | `verifier.ts`, `handleDelegates.ts`, renderer status badges |
| **Implementation sequence** | 1) UX copy. 2) Optional policy flag. |
| **Regression test target** | `handleDelegates.test.ts` partial/mixed rounds |
| **Verification** | Existing tests (51 pass) + manual |

**Git layer:** `M`.

---

#### AUD-M08 — Tool-round vs delegation-round “three-strike” naming collision

| Field | Detail |
|-------|--------|
| **Severity** | Medium (maintainability) |
| **Evidence** | `handleDelegates.ts:10-13` delegation strikes; `runLoop.ts:1158` tool-round strikes; `01-orchestration-loop.md` delegate section |
| **Impact** | Operators confuse counters in logs/`run_state`. |
| **Root cause** | Same metaphor, two counters. |
| **Recommended fix** | Rename in harness (`consecutive_bad_delegation` vs `consecutive_bad_tools`). |
| **Affected files** | Harness, `buildSystemPrompt`, run loop emitters |
| **Implementation sequence** | 1) Harness. 2) `<run_state>` labels. |
| **Regression test target** | None |
| **Verification** | Grep `three-strike` in logs |

**Git layer:** `M`.

---

#### AUD-M09 — `focusRow` exported but never called

| Field | Detail |
|-------|--------|
| **Severity** | Medium (maintainability) |
| **Evidence** | `useChatRowFocus.ts:82` export; ripgrep shows no call sites outside definition |
| **Impact** | Dead keyboard-nav API; plan may have intended timeline focus jumps. |
| **Root cause** | Incomplete wiring after redesign. |
| **Recommended fix** | Wire to JumpChip replacement or delete export. |
| **Affected files** | `useChatRowFocus.ts`, timeline keyboard handler |
| **Implementation sequence** | 1) Product decision. 2) Wire or remove. |
| **Regression test target** | Renderer keyboard test |
| **Verification** | `npm run knip` export count drops |

**Git layer:** `??`/`M` renderer hooks.

---

#### AUD-M10 — Attachment IPC uses `unknown` + dedicated parsers (acceptable but uneven)

| Field | Detail |
|-------|--------|
| **Severity** | Medium (maintainability / defense in depth) |
| **Evidence** | `attachments.ipc.ts:125-138` `input: unknown` with `parseAttachmentPathInput` (lines 15-28 area) |
| **Impact** | Lower risk than hypothesized “uneven validation”; pattern is intentional. Document as standard for blob-like inputs. |
| **Root cause** | N/A — recon partially overstated. |
| **Recommended fix** | Add comment in `validate.ts` pointing to attachment parsers; no code required for audit. |
| **Affected files** | `attachments.ipc.ts` |
| **Implementation sequence** | Docs only. |
| **Regression test target** | Existing attachment tests if any |
| **Verification** | `npx vitest run tests/main/` filter attachments |

**Git layer:** `??` `attachments.ipc.ts`.

---

#### AUD-M11 — EOF/encoding policy split across `read.tool` and `editFileEncoding`

| Field | Detail |
|-------|--------|
| **Severity** | Medium (maintainability) |
| **Evidence** | `read.tool.ts` BOM/binary rules; `editFileEncoding.ts` BOM/CRLF for edits |
| **Impact** | Edge-case divergence (read refuses binary edit might mishandle). |
| **Root cause** | Separate evolution paths. |
| **Recommended fix** | Shared `fileTextEncoding.ts` module; table in `project.md`. |
| **Affected files** | `read.tool.ts`, `edit.tool.ts`, `editFileEncoding.ts` |
| **Implementation sequence** | 1) Extract shared types. 2) Cross tests. |
| **Regression test target** | `tests/main/tools/` |
| **Verification** | Vitest tools |

**Git layer:** `??` `editFileEncoding.ts`.

---

### Low

#### AUD-L01 — Unused `ConfirmDialog.tsx`

| Field | Detail |
|-------|--------|
| **Severity** | Low (dead code) |
| **Evidence** | `knip-fresh.json` lists `src/renderer/components/ui/ConfirmDialog.tsx` as unused file; `ConfirmHost` uses `DestructiveConfirm` + edit dialogs |
| **Recommended fix** | Delete file or wire to simple confirms. |
| **Verification** | `npm run knip` |

**Git layer:** untracked/staged mix.

---

#### AUD-L02 — Knip unused exports (`traceSanitize`, `toolInflight`, theme helpers)

| Field | Detail |
|-------|--------|
| **Severity** | Low |
| **Evidence** | `knip-fresh.json` — `sanitizeFilePathLabel`, `subagentHasInflightDiff`, `DEFAULT_THEME_PREFS`, etc.; imports in `AgentTraceContent.tsx` / `ToolGroupRow.tsx` **resolve** (not broken) |
| **Note** | Prior recon “broken imports” **not confirmed** — files exist. |
| **Recommended fix** | Remove unused exports or use them. |
| **Verification** | `npm run knip` |

---

#### AUD-L03 — Unused `@fontsource` dependencies

| Field | Detail |
|-------|--------|
| **Severity** | Low |
| **Evidence** | `knip-fresh.json` package.json entries for geist fonts |
| **Recommended fix** | Remove deps or import in `index.css` entry. |
| **Verification** | `npm run knip` |

---

#### AUD-L04 — Duplicate typography tokens in `index.css` themes

| Field | Detail |
|-------|--------|
| **Severity** | Low |
| **Evidence** | `index.css:185-192` base sizes; `index.css:227-235` theme overrides for `--text-chat-body`, `--text-row` |
| **Impact** | Density modes can surprise designers; not a runtime bug. |
| **Recommended fix** | Consolidate per theme block; document matrix in plan POL items. |
| **Verification** | Visual regression |

**Git layer:** `M` `index.css`.

---

#### AUD-L05 — `git diff --check` clean; EOF hygiene OK in index

| Field | Detail |
|-------|--------|
| **Severity** | Low (informational) |
| **Evidence** | `git diff --check` exit 0 at audit time |
| **Note** | Does not scan untracked `knip-*.json` clutter. |

---

#### AUD-L06 — Stale knip report artifacts in repo root

| Field | Detail |
|-------|--------|
| **Severity** | Low |
| **Evidence** | `knip-report.json`, `knip-fresh.json`, `knip-clean.json`, etc. in `git status` untracked |
| **Recommended fix** | `.gitignore` or delete; single CI artifact. |

---

## 4. Positive findings

| Area | Evidence | Why it matters |
|------|----------|----------------|
| **IPC hardening** | `wrapIpcHandler.ts:30-82` — only `ipcMain.handle`, structured logging, provider/cancel classification | Failures are diagnosable; no silent `on` channels found in `registerIpc` |
| **Supersede contract** | `chat.ipc.ts:284-304` abort all + `awaitRunSettlement` + `drainAppendChain` | Designed race closure for JSONL read-before-send |
| **Run finalization latch** | `chat.ipc.ts:622-650` drops post-terminal ghost events | Fixes ghost checkpoint rows after Stop |
| **Sandbox path containment** | `tools.ipc.ts:53+` + `realpathInsideWorkspace` patterns (orchestrator comments) | Reduces path escape risk |
| **Sub-agent pool error boundary** | `SubAgentPool.ts:124-154` converts throws to structured runs | Prevents `Promise.all` reject for single worker throw |
| **Delegate file pre-validation** | `handleDelegates.ts:172-199` | Surfaces invented paths before spawn |
| **Orchestrator tool policy enforced in code** | `orchestratorTools.ts:38-42` matches harness intent (`ls`, `memory`, `recall` only) | Stronger than prose alone |
| **Coalesced persistence** | `chat.ipc.ts` delta coalescer + implicit boundary flush | Reduces disk churn; documents emit-order defense |
| **Typecheck green** | `npm run typecheck` | Large redesign still type-safe |
| **Delegate test coverage** | 51 tests on `handleDelegates` / `parseDelegates` | Good baseline for regression when fixing C01/H07 |

---

## 5. Deferred / needs-runtime-repro appendix

| ID | Item | Why deferred |
|----|------|----------------|
| DEF-01 | Composer approval hidden under floating panel (click-through) | Needs Electron UI repro with strict approvals + Agent trace open |
| DEF-02 | RAM growth on 10k+ event transcripts | Needs profiler / heap snapshot (plan Phase 7) |
| DEF-03 | Provider-specific streaming reorder (`agent-text-aborted` vs late delta) | Provider-dependent; code has tombstones (H6) |
| DEF-04 | Attachment GC on conversation delete | `gc.ts` exists; needs delete-conversation integration test in running app |
| DEF-05 | Updater / first-launch Appearance (POL-8) | Product flow, not static audit |
| DEF-06 | `orchestratorPromptCache` stale on harness edit without restart | Documented in `harnessLoader.ts`; needs restart repro |

---

## 6. Mechanical cleanup appendix

(Separate from behavioral severities — safe janitorial pass.)

| Item | Path / command | Action |
|------|----------------|--------|
| Unused component | `src/renderer/components/ui/ConfirmDialog.tsx` | Delete or integrate |
| Knip unused exports | See `knip-fresh.json` | Trim exports or enable in code |
| Font deps | `package.json` `@fontsource-variable/geist*` | Import or remove |
| Root knip JSON clutter | `knip-*.json`, `knip-report.json` | gitignore / delete |
| knip config hints | `out/**`, `dist/**` in `knip.json` | Tidy ignore list |
| EOF | `git diff --check` | Currently clean |
| Broken imports | **Not found** — `traceSanitize.ts`, `toolInflight.ts` exist | Close false alarm |

**Verification:** `npm run knip`; `git diff --check`.

---

## 7. Phase cross-reference table

| Phase | Recon theme | Audit IDs | Verified? |
|-------|-------------|-----------|-----------|
| **1 — Orchestrator / IPC / persistence** | Silent append; pool abort; startRun drain; settlement timeout; IPC validation | C01–C03, H01–H02, M10 | Partially — IPC validation better than feared except attachments pattern |
| **2 — Harness / tools** | Three-strike wording; orchestrator tools; malformed openers; subagent memory; toolRerun; verifier | H04, H07, M05–M08 | orchestratorTools **aligned**; malformedOpeners **dead**; three-strike **two systems** (naming) |
| **3 — UI / UX** | z-index; orphan subagent tree; focusRow; aria-modal; FloatingPanel focus | H03, H05, M03–M04, M09, L04 | z-index risk **confirmed**; focusRow **unused** |
| **4–5 — Perf / dead code** | deriveRows; Markdown; knip; diff duplication; EOF | M01–M02, H06, L01–L06, M11 | knip **pass**; broken imports **refuted** |
| **Positive** | wrapIpcHandler, supersede, abort, registry | §4 | **Confirmed** |

---

## 8. Suggested fix order (parent agent)

1. **AUD-C01** (pool holes) — smallest crash fix, high leverage.  
2. **AUD-C02 + H02** (append propagation) — data integrity.  
3. **AUD-C03 + H01** (finalize + settlement timeout) — supersede reliability.  
4. **AUD-H03** (z-index / confirm layering) — user-blocking UX.  
5. **AUD-H07, H05, H06** — harness/parser and UX consolidation.  
6. Mechanical §7 in parallel with feature work.

---

*End of report.*

---

## Implementation status (2026-05-28)

**Prior pass (unchanged):** AUD-C01–C03, AUD-H01–H07.

**This pass:**

| ID | Status |
|----|--------|
| AUD-M01 | Fixed — split `deriveRows` / `applyDeriveRowsLiveLayer` in `Timeline.tsx` |
| AUD-M02 | Fixed — throttle streaming markdown + code highlight (`useThrottledValue`) |
| AUD-M03 | Fixed — focus trap + initial focus in `FloatingPanel` |
| AUD-M04 | Fixed — `aria-hidden` on `<main>` when overlay open; `ComposerDialog` `aria-modal` false when blocking overlay |
| AUD-M05 | Fixed — TypeScript/Electron paths in `00-prime-directives.md` |
| AUD-M06 | Fixed — transcript vs `memory` tool clarified in `04-subagent-prompt.md` |
| AUD-M07 | Fixed — `structuralVerdict` on IPC + Agent trace hint |
| AUD-M08 | Fixed — `consecutive_bad_delegation` / `consecutive_failed_tools` in harness + `<run_state>` |
| AUD-M09 | Fixed — `focusRow` wired from `BackgroundRunsBadge` |
| AUD-M10 | Fixed — doc pointer in `validate.ts` |
| AUD-M11 | Fixed — `@shared/text/fileTextEncoding.ts` + edit re-export |
| AUD-L01 | N/A — `ConfirmDialog.tsx` already absent |
| AUD-L02 | Deferred — knip unused exports left (low risk / wide blast radius) |
| AUD-L03 | N/A — fonts imported in `index.css`; already in `knip.json` ignore |
| AUD-L04 | Fixed — density override comment in `index.css` |
| AUD-L05 | N/A — informational |
| AUD-L06 | Fixed — `knip-*.json` in `.gitignore` |
| H05 orphan `timeline/subagent/` | N/A — tree already removed |
| H06 ReviewDiffViewer dedup | Deferred per scope |
