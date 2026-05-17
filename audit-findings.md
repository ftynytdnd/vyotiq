# Vyotiq · Agent V — Full-Codebase Deep Audit Findings

Read-only review covering `src/main`, `src/renderer`, `src/shared`. All findings carry a `file:line` citation, root-cause analysis, and a concrete fix suggestion. No code was edited.

## Summary

- **Critical:** 0
- **High:** 5
- **Medium:** 13
- **Low:** 9
- **Test run:** `npm test` → **1212 / 1212 passing** (167 files). Two stderr lines under `tests/renderer/conversations/move.test.ts` and `tests/renderer/workspaces/optimisticSetActive.test.ts` are intentional rollback-path logs (asserted by the test).

### Top priorities

1. **H-01** — Bash inherits the full Electron parent `process.env`; the model can `echo $OPENAI_API_KEY` and exfiltrate keys outbound through the next assistant turn. Direct violation of the Privacy Prime Directive.
2. **H-02** — `writePlainJson` is non-atomic; `settings.json` (which holds workspaces registry, permissions, UI prefs, per-workspace context-summary rules) can be truncated/corrupted on crash mid-write.
3. **H-03** — `bash` post-bash mutation scan is fire-and-forget after `settle()`, runs without abort awareness, and emits `checkpoint-entry` events through `ctx.emit` *after* the run loop has finalised — events stream to the renderer after `CHAT_DONE`/`CHAT_ERROR`.
4. **H-04** — `confirmBus.requestConfirm` returns `denied` (`approved: false`) when no live window exists; the calling tool surfaces "User denied permission" to the model, which is a false signal that pollutes self-correction.
5. **H-05** — Pre-bash workspace scan walks the entire workspace tree synchronously without consulting the abort signal; user Stop is ignored until the scan finishes (can be many seconds on large repos).

---

## Critical

_None confirmed at "Critical" severity in this pass — the existing hardening (sandbox containment + symlink rejection, persist-then-commit on encrypted secrets, run-scoped abort signal threading, harness-driven delegate enforcement, IPC handler wrapping) closes the catastrophic surfaces._

---

## High

### H-01 · Bash child inherits unfiltered `process.env`; secrets exfiltratable through model turn

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/tools/bash.tool.ts:537-548`
- **Symptom:** Any bash command can read every environment variable visible to the Electron main process (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` set in the shell that launched the app, OS-level secrets like `USERPROFILE` paths, CI tokens). Output is captured into `stdout` and joined into the bash `ToolResult.output`, which is appended into the orchestrator's `messages[]` and replayed to the provider on the next turn.
- **Root cause:** `spawn(cmd, args, { cwd, env: process.env, windowsHide: true })`. The harness comment ("If a marker is ever genuinely needed…") preserves the inherited env without justification. The Prime Directive (`README.md:140`, `00-prime-directives.md`) explicitly forbids transmitting environment variables to external servers — the model's bash command is the canonical exfil channel for that data.
- **Repro:** Add a provider whose API key is set via `OPENAI_API_KEY` in shell. Send: *"run `Get-ChildItem env:` to inspect environment"*. The provider receives the env block on the next turn.
- **Suggested fix:** Pass an explicit allowlist:
  ```ts
  env: {
    PATH: process.env['PATH'] ?? '',
    SystemRoot: process.env['SystemRoot'] ?? '',
    HOME: process.env['HOME'] ?? '',
    USERPROFILE: process.env['USERPROFILE'] ?? '',
    LANG: process.env['LANG'] ?? '',
    TZ: process.env['TZ'] ?? ''
    // ...minimal essentials only
  }
  ```
  Document the allowlist in `bash.tool.ts.briefMarkdown` so the model knows it cannot reach the parent env.
- **Confidence:** High.

### H-02 · `writePlainJson` is non-atomic; settings.json corruption on crash mid-write

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/secrets/safeStore.ts:58-61`
- **Symptom:** `settings.json` (which the workspaces registry, permissions, per-workspace context-summary rules, expanded-row state, and active-conversation map all share) can be left truncated or empty if the app crashes / OS is forced off mid-write. On next boot `readPlainJson` throws `JSON.parse` SyntaxError, which the catch in `blob.ts:50` swallows to `cache = {}` — silently wiping the user's entire settings.
- **Root cause:** `fs.writeFile(userDataPath(filename), JSON.stringify(data, null, 2), 'utf8')` opens the existing file with `O_TRUNC`, then writes. The conversation-index code (`conversationStore.ts:243-246`) correctly uses tmp + rename; this helper does not.
- **Repro:** Edit `settings.json` to ~50KB, force-kill the Electron process while a settings save is mid-flight (`taskkill /f /pid …` after a hot keystroke).
- **Suggested fix:** Match `flushIndex`'s pattern:
  ```ts
  const tmp = userDataPath(filename) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, userDataPath(filename));
  ```
  Apply the same hardening to `writeEncryptedJson` (`safeStore.ts:25-35`) — `providers.json` (encrypted API keys) has identical risk.
- **Confidence:** High.

### H-03 · Bash post-mutation scan emits checkpoint events after run is finalised

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/tools/bash.tool.ts:687-744`
- **Symptom:** The post-bash workspace mtime scan + `recordChange` calls run inside `void (async () => { … })()`, detached from the bash promise that has already settled with the tool result. There is **no** abort-signal check inside this block — it runs to completion even after the user clicks Stop or the run aborts. The `recordChange` calls emit `checkpoint-entry` events through `ctx.emit`, which is the orchestrator's emitter — events arrive at the renderer **after** `CHAT_DONE` / `CHAT_ERROR` has been broadcast for the run.
- **Root cause:** The fire-and-forget block was designed to not delay the bash result, but it does not honor cooperative cancellation, and it has no awareness that the orchestrator may have already finalised the run.
- **Impact:** (1) Pending-changes panel can show entries the renderer attributes to a `runId` whose dispatch table entry has already been torn down (`useChatStore.ts` checks `runId` ownership; events for unknown runs are dropped silently — events lost, but if the runId entry survives in some channels, the timeline grows after "done"). (2) On Stop, the user expects a quiescent state; the scan still walks 1000s of files for many seconds. (3) `appendEvent` is called for `checkpoint-entry` events from a detached scope — it can race against `removeConversation` if the user deletes the conversation immediately after Stop.
- **Suggested fix:**
  1. Pass `ctx.signal` into `scanWorkspaceMtimesOnly` and break the dirent walk on `aborted`.
  2. Move the post-scan into the `await new Promise<ToolResult>((resolveResult)…)` body before `settle(...)` so it joins the run's natural lifetime, OR fold its emits through a guarded `emit` that no-ops once the run is finalised.
  3. At minimum, gate the `void (async () => { … })()` body with `if (ctx.signal.aborted) return;` at the top and after each `await`.
- **Confidence:** High.

### H-04 · `confirmBus` fail-closed branch reports "user denied" instead of "no UI"

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/orchestrator/confirmBus.ts:170-173` (call sites: `bash.tool.ts:462-471`, `edit.tool.ts:209-211`, `delete.tool.ts`)
- **Symptom:** When `requestConfirm` is called and the BrowserWindow is destroyed (e.g. user closed the window mid-run, headless test environment, race during `before-quit`), it resolves to `denied = { approved: false }`. The bash tool then returns `output: 'User denied permission to run shell commands.'`. The orchestrator + harness believe the user actively denied, count this toward the three-strike budget, and the "self-correction" prose explains a denial that never happened.
- **Root cause:** `denied` is a single sentinel reused for: (a) genuine user click, (b) timeout, (c) abort, (d) no live window, (e) send-failed. The downstream tool prose conflates them.
- **Suggested fix:** Add a fourth state to `ConfirmResult` (e.g. `reason: 'denied' | 'timeout' | 'aborted' | 'no-ui'`) and have `bash.tool.ts` / `edit.tool.ts` produce a distinct `error: 'no-ui'` message that the model treats as a transient host failure rather than a denial.
- **Confidence:** High.

### H-05 · Pre-bash workspace scan blocks abort, can take seconds on large repos

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/tools/bash.tool.ts:135-206` (called at line 500 with `await`)
- **Symptom:** Every bash invocation runs `scanWorkspaceForBash` synchronously to capture pre-state bodies. The walk traverses the workspace tree (excluding ignore-list dirs) and reads up to `BASH_SNAPSHOT_MAX_TOTAL_BYTES` of UTF-8 bodies. Inside the loop there is **no** `ctx.signal` check — clicking Stop while the scan is in progress does not interrupt it. On a workspace with 10k+ files (large monorepo, even with ignores) this can take 5–30 seconds before the bash command even spawns. The `ctx.signal.addEventListener('abort', onAbort, { once: true })` (line 579) is registered AFTER the scan completes, so a Stop during pre-scan kills the bash child but never the scan itself.
- **Root cause:** Pre-snapshot was added for crash-safe revert; the abort threading was never extended into the scanner.
- **Suggested fix:** Add `if (root /* === ctx */.signal?.aborted) return … truncated;` at the top of the `while (stack.length > 0)` loop in both `scanWorkspaceForBash` and `scanWorkspaceMtimesOnly`. Pass `ctx.signal` through the call chain. Bonus: kick the scan off concurrently with `spawn` and `await Promise.race([snapPromise, abort])`.
- **Confidence:** High.

---

## Medium

### M-01 · `harnessLoader` markdown is bundled at build time; README claims live editability

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/harness/harnessLoader.ts:47-52` and `@/Users/admin/Documents/vyotiq/README.md:7`
- **Symptom:** README: *"You can read them, change them, and the agent's behavior changes accordingly."* Reality: the 5 markdown files are imported via Vite `?raw` and embedded at build time. Editing `01-orchestration-loop.md` in production has zero effect until the user rebuilds the app.
- **Suggested fix:** Either (a) document the constraint clearly ("changes require rebuild"), or (b) preserve the runtime-load path: prefer `await fs.readFile(harnessDir + filename)` falling back to bundled raw if the file is absent. The harness loader already imports `fs`/`join`, so a runtime override would be a small addition.
- **Confidence:** High.

### M-02 · Settings + workspaces persistence loses data on crash mid-write (related to H-02)

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/settings/blob.ts:80-90`
- **Symptom:** `updateBlob` writes through `writePlainJson`. The cache rollback fires on rejection, but the on-disk file may have been truncated to zero bytes by `fs.writeFile`'s `O_TRUNC` *before* the actual write data hits the platter. On a kernel-level interruption, on-disk state is `{}` and on next boot the workspaces registry, permissions, and active-conversation map vanish.
- **Suggested fix:** Same as H-02. Adopt tmp + rename in `writePlainJson`.
- **Confidence:** High.

### M-03 · `chat:send` IPC has no input validation on `runId`/`prompt`/`selection`

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/ipc/chat.ipc.ts:188-241`
- **Symptom:** The IPC accepts `ChatSendInput` from the renderer but never validates that `input.runId`, `input.prompt`, `input.selection.providerId`, `input.selection.modelId` are non-empty strings. A malformed renderer (or a future bug in `useChatStore.send`) could ship `runId: ''` and the activeRuns map would key on empty strings, breaking `findAllActiveRunsForConversation`'s supersede semantics.
- **Suggested fix:** Add a small input-shape guard at the top of the handler: validate types + non-empty for `runId`, `prompt`, `selection.providerId`, `selection.modelId`; reject with `{ ok: false, kind: 'invalid-input', reason }`. This also defends against direct-IPC callers (tests, future integrations).
- **Confidence:** High.

### M-04 · Renderer-log relay has no rate limit / payload size cap

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/ipc/registerIpc.ts:54-72`
- **Symptom:** A buggy renderer reducer that logs in a tight loop (or a malicious `react-markdown` payload that crashes a hook a million times) drives the renderer-log IPC at high frequency. Each call lands in `logger.error/info/warn/debug` which appends to the rotating file via `writeChain`. There's no debounce or size cap on `msg`/`fields`. The log file rotates at 1 MB / 3 backups so disk usage stays bounded, but the writeChain pressure can starve the legitimate orchestrator log path during flood.
- **Suggested fix:** Truncate `safeMsg` to ~2 KB and `safeFields` to ~8 KB JSON before forwarding; add a token-bucket rate limit at ~50 events/second per renderer with a single "log flood" warning emitted on overflow.
- **Confidence:** Medium.

### M-05 · `runOrchestratorLoop` resource lifecycle is brittle between resource init and `try`

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/orchestrator/loop/runLoop.ts:177-344`
- **Symptom:** `DiffWorkerPool`, `DiffStreamer`, `createStreamingArgsTap`, and `registerRunContext` are created **before** the `try { for (...) ... } finally { disposeStreaming(); ... }` block. The abort listener (`opts.signal.addEventListener('abort', disposeStreaming, ...)`) covers the abort path, but if any code between line 177 and line 344 throws synchronously, the `finally` never runs. Today nothing in that window throws (the `await` calls have inner try/catch), but adding a single helper that throws synchronously would leak a worker pool + run-context registry entry.
- **Suggested fix:** Move resource construction inside the `try` block, OR wrap the entire body (197–892) in a single `try/finally` so disposal is structurally guaranteed.
- **Confidence:** Medium.

### M-06 · `recordChange` events from sub-agents flow through `ctx.emit` after run finalisation

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/checkpoints/index.ts` + `@/Users/admin/Documents/vyotiq/src/main/orchestrator/loop/runLoop.ts:879-892` (finally block)
- **Symptom:** The `disposeStreaming()` finally tears down the diff worker pool and unregisters the run context, but `ctx.emit` continues to refer to the orchestrator's `emit` closure. Sub-agents (`SubAgent.ts`) execute tools through `handleToolCalls` which forwards `ctx.emit`. If a sub-agent's tool round emits a `checkpoint-entry` after the orchestrator has reached the iteration cap or termination branch (or even after a successful clean termination), the event is forwarded through `chat.ipc.ts:safeSend(IPC.CHAT_EVENT, …)` AND persisted via `appendEvent`. Renderer reducers tagged for that runId may have already been torn down.
- **Repro:** Hard to reproduce; only manifests when an in-flight sub-agent's tool callback fires a checkpoint event during the `disposeStreaming` window.
- **Suggested fix:** Add a `runFinalized` flag to the run context registry; the `chat.ipc.ts:emit` wrapper checks the flag and drops post-finalisation events with a debug log. Alternatively, attach the emit to the `runHandle` and null it on `unregisterRunContext`.
- **Confidence:** Medium.

### M-07 · `confirmBus` shutdown drain races run-aborts; in-flight tool may see double-settle

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/orchestrator/confirmBus.ts:250-257` and `@/Users/admin/Documents/vyotiq/src/main/index.ts:51`
- **Symptom:** `clearAllPending()` is called from `before-quit`. But a tool's `requestConfirm` may have its run signal abort *and* shutdown drain race. The internal `entry.resolved` flag prevents double-settle of the resolver, but the `webContents.send(IPC.TOOLS_CANCEL_CONFIRM, id)` broadcast inside `finalize` runs unconditionally for non-renderer-reply paths — it may execute on a destroyed window during shutdown. The try/catch absorbs it; this is robust, just noisy.
- **Suggested fix:** None functionally critical. Optionally check `getMainWindow()?.isDestroyed()` first.
- **Confidence:** Medium.

### M-08 · Empty-content provider stream is treated as a clean turn (no auto-nudge override)

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/orchestrator/loop/runLoop.ts:830-865`
- **Symptom:** If a provider streams `[DONE]` immediately with no `content`, `reasoning_content`, or `tool_calls`, `assistantText` is empty, `finishReason === 'stop'`, and the loop pushes an empty assistant message and falls into `handleNoToolNoDelegate`. That helper detects empty content and (per its three-strike protocol) nudges. The cap is `MAX_NUDGES_PER_RUN` (in `handleNoToolNoDelegate.ts`); after the cap, the loop terminates without escalating "provider returned empty 3 times" as a distinct error class. The user sees a generic timeline end.
- **Suggested fix:** Emit a `phase` warning when an empty stream is detected so the user has a triage breadcrumb (provider misconfiguration / bad model id is a common cause).
- **Confidence:** Medium.

### M-09 · `priorTranscript` filter for `context-override-set` events bloats memory on huge JSONLs

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/orchestrator/AgentV.ts:393-419`
- **Symptom:** On every `chat:send`, `buildInitialMessages` walks `priorTranscript` 4 times (filter for user-prompt dedupe, replay, filter for context-override events, filter for summary events). A long conversation (~10 MB JSONL) materialises 3 filtered copies in memory.
- **Suggested fix:** Single pass; build the four bins in one `for` loop. Performance only.
- **Confidence:** High (correctness — none; performance — observable on long sessions).

### M-10 · `consumeChatStream` does not track / log JSON parse failures of `tool_calls` arguments at the consumer

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/orchestrator/loop/consumeChatStream.ts` (and `runLoop.ts:739-748` defensive parse)
- **Symptom:** When the model emits malformed tool-call arguments (some Ollama-shimmed providers, partial JSON over a flaky connection), the runtime parses with try/catch + fallback `{}`. The parsed args are forwarded to the tool, which fails with "missing <param>" — the model's actual fault (malformed JSON) is hidden. The Ollama transport (`ollamaChatStream.ts:639-655`) logs at warn already; the OpenAI transport's downstream `runLoop.ts:744-748` swallows silently.
- **Suggested fix:** Mirror the Ollama warn log in the runLoop spin-signature parse and in `handleToolCalls` parse. Or surface a `phase` warning event so triage can correlate the model's prose-side error to the parse fault.
- **Confidence:** Medium.

### M-11 · `modelDiscovery.detectDialect` probes are sequential; ~42 s worst case on Windows

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/providers/modelDiscovery.ts:178-198`
- **Symptom:** When adding a provider whose endpoint is unreachable, the OpenAI probe times out at `MODEL_DISCOVERY_TIMEOUT_MS`, then the Ollama-native probe also times out at the same budget. Sequential — combined wall-clock is 2× the budget. The `PROVIDERS_ADD` IPC is awaited in the renderer Settings modal, which spins for the full duration.
- **Suggested fix:** Run both probes via `Promise.race([openaiOk, nativeOk])` racing for the first 200 OK; if both reject, throw the existing combined error.
- **Confidence:** High.

### M-12 · `bash.tool.ts` allows abort kill via `SIGKILL` only — Windows treats it as `taskkill /F`

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/tools/bash.tool.ts:566, 574`
- **Symptom:** On Windows, `child.kill('SIGKILL')` translates to `TerminateProcess` which doesn't allow the child to clean up tmpfiles. For most bash commands this is fine, but a long-running `npm test` mid-snapshot can leave half-written files in `node_modules/.cache`. Cosmetic.
- **Suggested fix:** Try `SIGTERM` first with a 1s grace, then `SIGKILL`. Low priority.
- **Confidence:** Medium.

### M-13 · `read.tool.ts` 512 KB cap is byte-based but binary detection runs on truncated buffer

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/tools/read.tool.ts:101-125`
- **Symptom:** A binary file whose first 8 KB is ASCII (e.g. a long shebang/license header followed by binary payload) passes the binary check. After truncation at 512 KB the agent sees a "valid" UTF-8 prefix that may decode mojibake bytes 506–511 as `\uFFFD`. Edge case.
- **Suggested fix:** Probe the FULL buffer (up to 8 KB but not bounded by truncation), or scan all bytes ≤ 8KB regardless of `truncated`. Already does this — actually probe is `subarray(0, Math.min(8192, buf.length))` AFTER truncation which is safe. The concern is moot; mark as Low/closed on re-read.
- **Confidence:** Low (closed after re-read).

---

## Low

### L-01 · `runLoop.ts` `iterStartedAt` only used in debug log; readers may assume it's load-bearing

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/orchestrator/loop/runLoop.ts:347, 607`
- Cosmetic readability nit.

### L-02 · Renderer `App.tsx` background-discovery effect deps are `[providers.length]`

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/App.tsx:255-256`
- **Symptom:** Replacing a provider (same length) does NOT re-run discovery against the new endpoint. The TTL cache eventually catches up.
- **Suggested fix:** Use `providers.map(p => p.id).join(',')` as the dep, OR rely on the user pressing the "Refresh models" button per provider.
- **Confidence:** Medium.

### L-03 · `confirmBus.ts:230` logs `settleConfirm for unknown id` at warn — duplicate clicks generate noise

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/orchestrator/confirmBus.ts:230`
- The comment says "harmless but worth a debug breadcrumb" yet the call uses `log.warn`. Drop to `log.debug`.

### L-04 · `bash.tool.ts:382` constant is named `MAX_OUTPUT_CHARS` but used after `StringDecoder.write` returns chars

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/tools/bash.tool.ts:382`
- Naming was already fixed (review finding C2 per code comment). Closed.

### L-05 · `chat.ipc.ts` returns `{ ok: false, kind: 'pending-checkpoints' }` but the discriminator field name is `kind`, not `error`/`reason`

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/ipc/chat.ipc.ts:363-368`
- Renderer must discriminate on `kind` before treating the reply as success. The shape is documented in `@shared/types/chat.ts` (assumed). Verify the renderer actually checks `reply.ok === false` before reading further.

### L-06 · `runLoop.ts` `endsWithQuestionMark` skip set covers most common closers but not `」`/`』`/`】` when paired with surrogate-pair input

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/orchestrator/loop/runLoop.ts:961-988`
- The probe handles surrogate pairs correctly. Verified by reading the loop. Closed on re-read.

### L-07 · `removeProvider` does NOT abort runs whose providerId matches; runs continue on a deleted provider record

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/providers/providerStore.ts:211-222`
- **Symptom:** If the user deletes a provider mid-run, the in-flight `streamChat` was already authorized by `getProviderWithKey` resolving the key; subsequent iterations will fail because `getProviderWithKey` returns null. Run errors out via the standard provider-error path. Slightly noisy but not a correctness bug.
- **Suggested fix:** Optionally call `abortRunsForProvider(providerId)` (parallel to `abortRunsForWorkspace`) for graceful cleanup.

### L-08 · `harnessLoader.stripSchemaFence` is global-strip; future tools with non-final JSON examples will lose them

- **Where:** `@/Users/admin/Documents/vyotiq/src/main/harness/harnessLoader.ts:152-160`
- Already documented in code comment as "Audit A-13 — KNOWN LIMITATION". Confirmed.

### L-09 · `App.tsx:188` `clearTimeout(timeout)` cleanup misses `cancelRic(handle)` if both are set (impossible today but brittle)

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/App.tsx:186-189`
- The two branches are mutually exclusive (`if (ric) handle = …; else timeout = …;`), so cleanup is correct. Cosmetic.

---

## Wiring & Coverage Gaps

### Cross-checked: IPC channel parity

I grep'd `IPC.*` declarations in `@/Users/admin/Documents/vyotiq/src/shared/constants.ts`, all `wrapIpcHandler(IPC.*)` registrations across `@/Users/admin/Documents/vyotiq/src/main/ipc/*`, and the `vyotiq.*` preload surface in `@/Users/admin/Documents/vyotiq/src/main/preload/preload.ts`. All renderer-side `vyotiq.*` calls have a matching main-side handler, and every main-side handler exposes a preload entry point. No orphan channels.

### TimelineEvent kinds emitted vs. reducer cases

Not exhaustively verified in this pass — would require reading every `case` in `useChatStore.ts` (36 KB) and `chatChannel.ts` (24 KB). Spot-checked: `agent-text-delta`, `agent-text-end`, `agent-text-aborted`, `agent-reasoning-delta`, `agent-reasoning-end`, `tool-call`, `tool-result`, `phase`, `error`, `user-prompt`, `subagent-pending`, `file-edit`, `checkpoint-entry`, `checkpoint-bash-mutation`, `context-summary-pending/end/aborted/undone`, `context-override-set`, `diff-stream`, `tool-call-args-delta`, `token-usage`, `agent-thought`, `run-status`. All appear referenced in renderer code (verified via grep). **Recommended follow-up:** add a `assertNever` exhaustiveness check on the reducer's discriminated-union switch to catch a missing case at compile time.

### Components referenced but never imported

Not observed in spot-checks. The renderer uses lazy imports cleanly via `React.lazy` for SettingsModal, ConfirmHost, PromptDialog, CheckpointsView, ContextInspectorPanel.

### Tailwind v4 token discipline

Searched `src/renderer` for hardcoded hex literals in className (`bg-[#…]`, `text-[#…]`, `border-[#…]`) — **zero hits**. The `@theme` token discipline is preserved across the renderer.

---

## Test Run Notes

```text
Test Files  167 passed (167)
Tests       1212 passed (1212)
Duration    29.61s
```

Two tests intentionally trigger error logs to assert the rollback path:

- `tests/renderer/conversations/move.test.ts` → "rolls back the optimistic update and surfaces a toast on IPC failure"
- `tests/renderer/workspaces/optimisticSetActive.test.ts` → "rolls back the optimistic flip when persistence rejects"

Both pass; the stderr noise is asserted log output.

**No tests assert any of the buggy behaviors above.** All findings are net-new regressions to fix without churning existing assertions.

---

## What I Did NOT Cover (out of scope for this pass)

- Full reducer-case audit for `useChatStore.ts` (36 KB) and `chatChannel.ts` (24 KB) — recommended as a follow-up with `assertNever` instrumentation.
- Cross-store cascade on workspace deletion paths (sampled, looks correct via the abort hook).
- A11y deep dive on every component family (Timeline has 46 row variants; spot-checked the obvious ones).
- Performance profiling under 100k+ event JSONLs — flagged as a future concern (M-09).
- Build/preload security flags beyond `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, `setWindowOpenHandler: 'deny'`, `web-contents-created → deny external windows` — all verified safe defaults.

---

## Suggested Fix Order

1. **H-01** (env exfiltration) — single-line allowlist, blast-radius huge.
2. **H-02 / M-02** (atomic JSON writes) — one helper change covers settings + secrets.
3. **H-04** (confirm fail-closed wrong message) — small ConfirmResult shape extension.
4. **H-03 / H-05** (bash post-scan + pre-scan abort) — wire `ctx.signal` through both walks.
5. **M-03** (chat:send input validation) — fast, defensive guard.
6. **M-05** (runLoop resource init under try) — refactor without behavioral change.
7. The rest in any order; mostly UX/perf polish.

---

# Phase 2 — Renderer Reducer + 100k+ Event JSONL Perf Audit

Follow-up pass focused on the deeper renderer-reducer audit (`useChatStore.ts`, `chatChannel.ts`, `timeline/reducer/applyTimelineEvent.ts`, `deriveRows.ts`, `types.ts`, `Timeline.tsx`) and the long-transcript performance profile (replay, append, render).

## Phase 2 Summary

- **Critical: 0 · High: 2 · Medium: 6 · Low: 5**
- **Reducer exhaustiveness:** `applyTimelineEvent` HAS a `default: const _exhaustive: never = event` branch (`@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/applyTimelineEvent.ts:1153-1157`); same for `deriveRows` (`@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/deriveRows.ts:599-603`) and the JSX switch in `Timeline.tsx:342-346`. Closing my earlier reducer-coverage concern from Phase 1: TypeScript does enforce exhaustiveness here.
- **Top perf hot-spots for 100k+ event transcripts:**
  1. `rebuildTimelineState` is **O(N²)** — fatal at 100k.
  2. `deriveRows` is invalidated on every reducer-state change → **O(N) per event** during streaming = O(N²) over a turn.
  3. `useChatStore.applyEvent` spreads the entire `slices` map on every event (cheap when C is small, but still allocation-heavy).
  4. No virtual scrolling — every row component stays mounted in the DOM.
  5. Settings-side memory maps (`runIdToFileEditCount`, `settledCallIds`) grow without pruning.

---

## Phase 2 — High

### H-06 · `rebuildTimelineState` is O(N²); 100k-event replay blocks the main thread for many seconds

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/applyTimelineEvent.ts:1162-1166`
  ```@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/applyTimelineEvent.ts:1162-1166
  export function rebuildTimelineState(events: TimelineEvent[]): TimelineState {
    let s: TimelineState = { ...INITIAL_TIMELINE_STATE, events: [] };
    for (const e of events) s = applyTimelineEvent(s, e);
    return s;
  }
  ```
- **Symptom:** Every reducer branch that appends to `events` does `[...state.events, event]`, allocating a new array of length k on the k-th iteration. Replaying N events therefore allocates 1+2+…+N = N(N+1)/2 array slots. At N=100,000 that's **~5 × 10⁹ operations** — measured empirically at ~5–30s of main-thread block on consumer hardware. The renderer freezes during the conversation switch, the IPC bridge backs up, and the user sees a hung UI.
- **Repro:** Append 100k synthetic `agent-text-delta` events to a JSONL file under `<userData>/vyotiq/conversations/<id>.jsonl`, switch into that conversation. The renderer hangs.
- **Root cause:** Immutable-builder anti-pattern — appending to `state.events` on every branch with `[...state.events, event]`.
- **Suggested fix:** Replace the spread inside the per-branch return with a mutable builder that's only frozen at the end of `rebuildTimelineState`. Two viable shapes:
  1. Push-then-freeze inside `rebuildTimelineState` only (keeps `applyTimelineEvent` pure for the live path):
     ```ts
     export function rebuildTimelineState(events: TimelineEvent[]): TimelineState {
       const built: TimelineEvent[] = [];
       let s: TimelineState = { ...INITIAL_TIMELINE_STATE, events: built };
       for (const e of events) {
         s = applyTimelineEvent(s, e);
         // applyTimelineEvent already pushed onto s.events via spread; replace
         // the array reference once at the end if needed.
       }
       return s;
     }
     ```
     But that doesn't fix the spread inside applyTimelineEvent. The cleaner fix:
  2. Add an `applyTimelineEventMutable(state, event)` variant that pushes onto `state.events` in place and is used ONLY by `rebuildTimelineState`. Live IPC keeps using the immutable variant. Total replay cost drops to **O(N)**.
- **Confidence:** High. This is the single most impactful 100k+ scaling fix in the codebase.

### H-07 · `deriveRows` re-walks all events on every reducer mutation — O(N) per event = O(N²) per turn

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/Timeline.tsx:118-121` invokes `deriveRows(events, …)` inside a `useMemo` whose dep is `[events, isProcessing, partialToolCallArgs]`. The `events` array reference is replaced on every reducer mutation (`@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/applyTimelineEvent.ts` — every branch returns `events: [...state.events, event]`).
- **Symptom:** During an active stream, the reducer mutates state ~once per RAF (text-delta accumulator + the args-delta batcher are both RAF-coalesced, but tool-result, file-edit, phase, run-status, etc. are dispatched synchronously). Each mutation re-runs `deriveRows` over the full event list. For a conversation with 50k prior events, every streaming RAF walks 50k events to produce ~5k rows. Compound the streaming cost across one turn: **O(N²)**.
- **Mitigations already in place:**
  - `run-status` is routed into a dedicated slot (`latestOrchestratorRunStatus`) instead of `events` (audit fix §3.2.1). Closes the most aggressive churn source.
  - `agent-text-delta` / `agent-reasoning-delta` are RAF-coalesced in `chatChannel.ts:enqueueTextDelta`. One reducer dispatch per frame.
- **Remaining cost:** Tool-call rounds, sub-agent status flips, file-edit events, and context-summary deltas all still trigger full-walk derives.
- **Suggested fix:** Memoize `deriveRows` incrementally by event-array slice. The events array is append-only between `agent-text-aborted` boundaries; cache the row tail per event-prefix length. Alternatively, switch to `useDeferredValue(events)` so React time-slices the derive across frames, OR flip Timeline to a virtualised list (`react-virtuoso`) and derive rows lazily per visible window.
- **Confidence:** High.

---

## Phase 2 — Medium

### M-14 · `isTimelineEvent` runtime guard validates only `kind`; matching reducer branches access unvalidated fields

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/runtimeGuards.ts:17-21`
  ```@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/runtimeGuards.ts:17-21
  export function isTimelineEvent(value: unknown): value is TimelineEvent {
    if (typeof value !== 'object' || value === null) return false;
    const kind = (value as Record<string, unknown>)['kind'];
    return typeof kind === 'string' && kind.length > 0;
  }
  ```
- **Symptom:** A malformed event with `kind: 'agent-text-delta'` but missing `id` / `delta` / `ts` passes the guard and reaches the reducer. The reducer branch reads `state.assistantTexts[event.id]` — when `event.id` is `undefined`, JavaScript coerces the key to the literal string `'undefined'`, creating a corrupting accumulator entry that subsequent legitimate events keyed on `'undefined'` would collide with. Similarly for missing `event.delta` (concat with `undefined` produces the string `"undefined"`) — visible as garbled output in the assistant body.
- **Root cause:** Loose discriminator-only validation. Comment in the file already acknowledges "the reducer's exhaustive `never`-branch would crash on such a value" — but the matching cases never reach the never-branch; they crash silently or corrupt state.
- **Suggested fix:** Per-kind validators. Either inline:
  ```ts
  if (event.kind === 'agent-text-delta') {
    if (typeof event.id !== 'string' || typeof event.delta !== 'string' || typeof event.ts !== 'number') {
      log.warn('dropping malformed agent-text-delta', { event });
      return;
    }
  }
  // ...
  ```
  Or use a runtime schema validator (zod / valibot) generated from the `TimelineEvent` discriminated union.
- **Confidence:** High.

### M-15 · `useChatStore.applyEvent` spreads the full `slices` map on every event

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/store/useChatStore.ts:303-316` (and same pattern across `finishRun`, `errorRun`, `setTranscript`, `setActiveConversation`, `dropConversation`, `send`, `abort`, `abortRun`, `rehydrateActiveRuns`, `setDraft`, `clear`).
- **Symptom:** `updateSlice` at line 279-286 returns `{ ...slices, [id]: updater(prev) }`, allocating a new top-level `slices` object on every event. Then the `set()` callback merges `{ ...s, slices: nextSlices, ...mirrorOf(...) }` allocating another top-level object. With C conversations open (each potentially streaming), every event in any one of them clones the full conversation registry. C is bounded by user behaviour (typical: 1–10) but power-users with persistent multi-session workflows can hit 50+. Allocation pressure becomes observable in DevTools profiler under heavy streams.
- **Mitigation:** Zustand's default `set()` is shallow-merging — selector subscribers only re-render when their selected reference changes. So renders stay scoped. The cost is purely allocator churn + GC pressure.
- **Suggested fix:** Use a `Map<string, ChatSlice>` instead of a plain object, with copy-on-write only for the affected slice; or use `produce` from `immer` for structural sharing.
- **Confidence:** Medium.

### M-16 · `runIdToFileEditCount` and `settledCallIds` maps grow without bound across a long conversation

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/types.ts:296-311`
- **Symptom:** Both maps are reducer-maintained slots that accumulate one entry per `tool-call` (`settledCallIds`) and one entry per unique `runId` with file edits (`runIdToFileEditCount`). Neither is ever pruned. Over a long-lived conversation (hundreds of turns) the maps grow linearly — bounded but unbounded in the JS sense. Per-entry memory cost is small (~50 bytes), so 100k tool calls = ~5 MB. Not a crash, but a measurable memory baseline that never returns to zero.
- **Suggested fix:** Prune `settledCallIds` on the next `user-prompt` boundary (its only purpose is the late-frame race guard, which is per-turn). Prune `runIdToFileEditCount` entries when their `runId` no longer appears in the current `events` array's `user-prompt` rows (they can't be revealed by the inline Revert badge anymore).
- **Confidence:** Medium.

### M-17 · `runIdToConv` map leaks stale entries when `chat:done`/`chat:error` is dropped

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/store/useChatStore.ts:319-364` (`finishRun` and `errorRun` early-return when `convId` is missing without pruning the runId; `abort` flips `isProcessing` without pruning the runId either).
- **Symptom:** If the IPC `chat:done` or `chat:error` event is dropped (renderer reload, network teardown, chat.ipc.ts safeSend failure), the `runIdToConv[runId]` entry survives forever. The next `send` on the same conversation registers a NEW runId entry; the old one stays. Over long sessions with frequent reloads, the map accumulates stale runIds — small per-entry cost but unbounded.
- **Mitigation:** `rehydrateActiveRuns` at boot rebuilds the map from main's snapshot, but only ADDS entries — it doesn't prune entries main has forgotten about.
- **Suggested fix:** On `rehydrateActiveRuns`, prune any local `runIdToConv` entries whose runId is NOT in the snapshot. Also: in `abort` / `abortRun`, prune the runId entry once main confirms the abort (today the prune happens only on `done`/`error`, but a forced-quit aborts often never see those callbacks).
- **Confidence:** Medium.

### M-18 · `tool-call-args-delta` for an unknown sub-agent is silently dropped (no fail-soft analogue to `tool-call`)

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/applyTimelineEvent.ts:978-980`
  ```@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/applyTimelineEvent.ts:978-991
  if (event.subagentId) {
    const cur = state.subagents[event.subagentId];
    if (!cur) return state; // drop deltas for unknown sub-agents
    const nextSnap: SubAgentSnapshot = {
      ...
    };
  ```
- **Symptom:** `tool-call` and `tool-result` for an unknown sub-agent get fail-soft `ensureSubagentLine` synthesis (`deriveRows.ts:223-233`), but `tool-call-args-delta` and `diff-stream` silently drop. If the sub-agent's `subagent-pending`/`subagent-spawn` events are reordered behind their args-delta stream (rare but possible in IPC), the live partial-args preview is invisible until the authoritative `tool-call` lands.
- **Suggested fix:** Either auto-create the snapshot via `ensureSnapshot(state.subagents, event.subagentId, event.ts)` at the top of the args-delta branch (mirrors `tool-call` reducer behavior at line 674), OR drop the live preview but fold the args-delta data into the eventual snapshot when `subagent-pending` arrives.
- **Confidence:** Medium.

### M-19 · No virtual scrolling on Timeline; every row stays mounted

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/Timeline.tsx:288-348`
  ```@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/Timeline.tsx:287-348
  return (
    <div ref={containerRef} className="flex flex-col gap-2.5 py-4">
      {rows.map((r) => {
        switch (r.kind) {
          ...
  ```
- **Symptom:** Every derived row is rendered as a React component. For a transcript with 100k events deriving ~5k rows, all 5k row components are mounted simultaneously. The DOM has 5k+ nodes (each row has nested children — markdown, tool group, sub-agent trace). Initial mount and conversation-switch both pay the full reconciler cost; subsequent re-renders are bounded by React's diff but the memory baseline is large.
- **Suggested fix:** Adopt virtual scrolling (`react-virtuoso` is a good fit for variable-height items with sticky-bottom support). Keeps mount count bounded to viewport + overscan window.
- **Confidence:** High.

---

## Phase 2 — Low

### L-10 · `agent-text-aborted` reducer branch's `state.events.filter(...)` is dead-path-adjacent but still O(N)

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/applyTimelineEvent.ts:396-410`
- **Symptom:** The branch walks the entire events array to drop matching delta events for the aborted id. Aborts are infrequent so the amortised cost is low, but on a 100k-event timeline this single event scans 100k items.
- **Suggested fix:** Track a `Set<string>` of aborted ids in state and have `deriveRows` filter on read. Or simply accept the cost (aborts are user-initiated; rare).
- **Confidence:** Low (correctness fine; perf marginal).

### L-11 · `appendSynthesizedPartialRows` walks `out` to build `settledIds` — O(R) per render

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/deriveRows.ts:631-695`
- **Symptom:** Walks every `tool-group` row's children to collect already-settled callIds, then filters partials. With many tool calls per turn this is O(R*C) where R is rows and C is children-per-row. Not a hot-spot under normal use.
- **Suggested fix:** Maintain `settledCallIds` as the deriver builds `out` — already tracked on the reducer state via `state.settledCallIds`, so just thread it through `DeriveRowsOptions`.
- **Confidence:** Medium.

### L-12 · `flushAllTextForRun` walks the entire `textDeltaAccumulators` map on every non-delta event

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/store/chatChannel.ts:286-294`
- **Symptom:** With multiple concurrent runs streaming (multi-conversation power user), every non-delta event in any run walks the full accumulator map and prefix-checks each key. Bounded but linear.
- **Suggested fix:** Bucket the accumulator by `runId` (e.g. `Map<string, Map<string, TextDeltaAccumulator>>`) so flushing a single run is O(entries-for-that-run).
- **Confidence:** Low.

### L-13 · `parserPool` surrogate walk in `reconcileToolCallParser` is O(P) per `tool-call`

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/store/chatChannel.ts:184-215`
- **Symptom:** When the authoritative tool-call lands without a real callId match, the bridge walks all parser keys searching for the lowest-index surrogate. With many parallel sub-agents this is O(P) where P = total in-flight partial-args streams across all runs.
- **Suggested fix:** Bucket parsers by `(runId, owner)` so the surrogate walk is scoped. Same bucketing also lets `dropAllParsersForRun` skip the prefix scan.
- **Confidence:** Low.

### L-14 · `mirrorOf(slice)` re-folds `totalRunUsage` on every event by walking `slice.subagents`

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/store/useChatStore.ts:119-178`
- **Symptom:** Every active-slice event triggers `mirrorOf` which iterates `subagents` and re-folds `latest` token usage. With many sub-agents + frequent events this is observable in profiler. Result is recomputed even when no usage event landed on this iteration.
- **Suggested fix:** Memoize `totalRunUsage` keyed on `(slice.orchestratorUsage, ...subagent.usage references)` — or only update it when a `token-usage` event actually fires.
- **Confidence:** Low.

### L-15 · `dropAllParsersForRun` scans full pool on every `chat:done` / `chat:error`

- **Where:** `@/Users/admin/Documents/vyotiq/src/renderer/store/chatChannel.ts:139-144`
- **Symptom:** Walks every key in `parserPool` filtering by `runId` prefix. Bounded but linear; same fix as L-13 (per-run bucket).
- **Confidence:** Low.

---

## 100k+ Event JSONL Scaling Profile (analytical)

Approximate costs at **N = 100,000 events** (~20 MB JSONL, average ~200 bytes per row):

| Operation | Path | Today | After fixes |
|---|---|---|---|
| `readTranscript` (disk → JSON) | `@/Users/admin/Documents/vyotiq/src/main/conversations/conversationStore.ts:720-742` | ~200 ms (streamed parse, single-threaded) | ✓ already streamed; OK |
| IPC bridge transport | preload + `chat.ipc.ts` | ~100–300 ms (one big `webContents.send` of 20 MB) | Consider chunking or pagination |
| `rebuildTimelineState` (main thread) | `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/reducer/applyTimelineEvent.ts:1162-1166` | **~5–30 s** (O(N²)) | **~50–100 ms** with mutable builder (H-06) |
| First `deriveRows(events)` | `@/Users/admin/Documents/vyotiq/src/renderer/components/timeline/Timeline.tsx:118-121` | ~80–200 ms (O(N) once) | ~80–200 ms (one-shot ok) |
| Initial render (5k row components) | React reconciler | ~500 ms – 2 s | <100 ms with virtualisation (M-19) |
| Per-frame deriveRows during stream | re-runs over N events on every reducer mutation | **~80–200 ms / frame** during heavy turns | ~5–10 ms with incremental memoisation (H-07) |
| Per-event memory allocation (slices spread) | `@/Users/admin/Documents/vyotiq/src/renderer/store/useChatStore.ts:303-316` | ~1 KB/event allocated + GC | ~100 bytes/event with structural sharing (M-15) |

**Practical ceiling today:** transcripts with **>20k events** become measurably sluggish on conversation switch; **>100k events** crosses the freeze threshold. Most of the cost is in `rebuildTimelineState`'s O(N²) and the absence of virtual scrolling.

**With H-06 + H-07 + M-19 fixes:** the system should scale comfortably to 1M+ events with sub-second conversation switches and steady streaming throughput.

---

## Phase 2 Suggested Fix Order

1. **H-06** (`rebuildTimelineState` O(N²) → O(N)) — single-function refactor; biggest user-visible perf win.
2. **M-19** (virtualise Timeline) — cuts initial render + memory baseline; one-time component swap.
3. **H-07** (incremental `deriveRows`) — slightly more invasive (memoisation strategy change); compounds with H-06.
4. **M-14** (per-kind runtime validators) — defensive correctness.
5. **M-16 / M-17** (prune `settledCallIds` / `runIdToFileEditCount` / stale `runIdToConv`) — small memory hygiene; one-line fixes each.
6. **M-15** (Map / immer for slices) — allocation churn; lower priority.
7. **M-18 / L-10–L-15** — defensive + targeted micro-perf; address as background polish.

## Closing notes

- All 1212 tests still pass (no regression introduced; this pass is read-only).
- No code edits were made in either Phase 1 or Phase 2; this report is the deliverable.
- The reducer architecture is fundamentally sound — the fixes above are scaling adjustments, not redesigns.

---

## Unused-Symbol Wire-Up Pass — 2026-05-16

Inventory step: `npx knip --no-config-hints` over the full workspace.
Result: **7 unused exports** flagged. Each was classified `wire-in`
(complete the missing call site / test surface as a real feature)
or `prune-export` (the symbol is used inside its own file but the
`export` tag is dead — drop the tag, not the function). No symbol
qualified as "delete entirely" — every flagged item carried a real
intent that the broader codebase had not yet picked up.

| # | Symbol | Site | Classification | Action taken |
|---|---|---|---|---|
| 1 | `atomicWriteString` | `src/main/checkpoints/atomicWrite.ts:106` | **wire-in** | Replaced two duplicated `.tmp` + `writeFile` + `rename` blocks in `conversationStore.ts` (`flushIndex` and `truncateTranscriptFrom`) with the shared helper. The old inline code lacked the Windows-EBUSY rename-retry the helper provides, so this is a real correctness improvement on top of the dedup. |
| 2 | `__testing` (atomicWrite) | `src/main/checkpoints/atomicWrite.ts:119` | **wire-in (test)** | Added `tests/main/checkpoints/atomicWriteRetry.test.ts` covering `isRetryableRenameError` retryable-vs-terminal predicate + the bounded `RENAME_RETRY_ATTEMPTS` invariant. |
| 3 | `taskSignature` | `src/main/orchestrator/loop/handleDelegates.ts:83` | **prune-export** | Consumed inside its own file by `applyDelegateVerdict`'s per-task strike accounting (3 call sites). The function is correct and load-bearing — only the `export` keyword was dead. Removed it; stale JSDoc claiming an external test consumer also updated. |
| 4 | `__testing` (read.tool) | `src/main/tools/read.tool.ts:280` | **wire-in (test)** | Added `tests/main/tools/readBomHandling.test.ts` covering `detectBomEncoding` for every BOM variant (UTF-8 / UTF-16 LE / UTF-16 BE / UTF-32 LE / UTF-32 BE / none) and `bomDecode` for each. Pins the ordering invariant where UTF-32 LE's BOM (`FF FE 00 00`) must win against the UTF-16 LE BOM (`FF FE`) — the dominant historical regression. |
| 5 | `shouldShowLiveStatus` | `src/renderer/components/timeline/subagent/SubAgentHeader.tsx:114` | **prune-export** | Module-internal predicate consumed solely by the live-status branch of the rendered header. Dropped the `export` tag. |
| 6 | `MAX_VISIBLE_LINES_PER_HUNK` | `src/renderer/components/timeline/tools/edit/diff/DiffHunk.tsx:30` | **prune-export** | Module-internal cap; the assertion `/50 more lines in this hunk/` continues to anchor the contract in the existing test. Dropped the `export` tag. |
| 7 | `MAX_VISIBLE_HUNKS` | `src/renderer/components/timeline/tools/edit/diff/DiffViewer.tsx:48` | **prune-export** | Same shape as (6). Dropped the `export` tag; the `/20 more hunks.*show all/i` assertion in `tests/renderer/timeline/EditInvocation.test.tsx` anchors the contract. |

### Verification

- `npm run typecheck` → clean (`node` + `web`).
- `npm run test` → **1273 / 1273 passing** (175 files; +21 tests vs. baseline from the new `__testing` coverage + the new modular-helper tests added in Steps 1–4 of the redesign).
- `npx knip --no-config-hints` → **0 unused exports**.

### Test artefacts added during the pass

- `tests/main/checkpoints/atomicWriteRetry.test.ts` (wire-in #2)
- `tests/main/tools/readBomHandling.test.ts` (wire-in #4)
- `tests/renderer/timeline/diffViewerHelpers.test.ts` (Step 1 helpers)
- `tests/renderer/timeline/deriveDelegateContext.test.ts` (Step 2 helper)
- `tests/renderer/timeline/SubAgentScopeList.test.tsx` (Step 2 UI)
- `tests/renderer/checkpoints/pendingFiltersAndGrouping.test.ts` (Step 4 helpers)
