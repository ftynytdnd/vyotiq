/**
 * Application-wide constants. Imported by both main and renderer.
 */

import type { ChatPermissions } from './types/chat.js';

export const APP_NAME = 'Vyotiq';
export const AGENT_NAME = 'Agent V';

/**
 * Default chat permissions. Single source of truth — both the renderer
 * settings store and the main settings blob seed from this constant so
 * the wire defaults stay in lockstep.
 *
 * `allowAuto` defaults to `false` on a fresh install so first-time
 * users see a confirm prompt for every gated tool call (edits, deletes,
 * shell commands, web search, reports). Users opt into the unattended
 * path per-workspace via the composer's "Trust this workspace" toggle.
 */
export const DEFAULT_PERMISSIONS: ChatPermissions = {
  allowAuto: false
};

/**
 * Maximum characters of a single tool's `output` we retain in replay /
 * persisted history. Larger outputs are truncated with a `…[truncated]`
 * marker so the model still sees the head without bloating context.
 */
export const MAX_TOOL_OUTPUT_CHARS = 8_000;

/** Folder name used inside the workspace for memory + agent artifacts. */
export const WORKSPACE_DOTDIR = '.vyotiq';

/** Subfolder inside WORKSPACE_DOTDIR for markdown notes. */
export const MEMORY_SUBDIR = 'memory';

/**
 * Subfolder inside WORKSPACE_DOTDIR where the `report` tool writes
 * self-contained HTML deliverables. Per-workspace by design — a
 * report is contextually tied to the workspace it was generated
 * from, and stamping it under `.vyotiq/` keeps agent artifacts
 * cleanly separated from the user's own files.
 */
export const REPORTS_SUBDIR = 'reports';

/**
 * Hard cap on the `body` argument of the `report` tool. The cap
 * exists for two independent reasons:
 *   1. Transcript health — the model's tool call is replayed into
 *      its own context on subsequent turns; a 10 MB report body
 *      would shred the conversation budget.
 *   2. Resource sanity — even with the cap, a saved report can
 *      still grow well beyond `body` size after the chart-lib UMD
 *      is inlined (Chart.js adds ~250 KB). 2 MB of model-authored
 *      body is far more than any realistic deliverable needs.
 * Excess input returns a structured failure so the model can
 * self-correct (split into multiple reports / drop verbose code).
 */
export const MAX_REPORT_HTML_BYTES = 2 * 1024 * 1024;

/** Files inside the global userData folder. */
export const GLOBAL_META_FILE = 'meta-rules.md';
export const PROVIDERS_FILE = 'providers.encrypted.json';
export const SETTINGS_FILE = 'settings.json';

/** Model discovery cache TTL (ms). */
export const MODEL_DISCOVERY_TTL_MS = 5 * 60 * 1000;

/**
 * Per-fetch wall-clock budget for provider model-discovery requests
 * (`detectDialect` probes, `fetchOpenAiModels`, `fetchOllamaTags`).
 *
 * The hard cap protects the UX path: PROVIDERS_ADD / PROVIDERS_TEST /
 * boot-time auto-refresh would otherwise hang indefinitely (until the
 * runtime's default socket timeout — minutes on Linux, ~21s on
 * Windows) when a user-typed base URL resolves at DNS but never
 * responds (firewall blackhole, mistyped subdomain pointing at a
 * non-listening port, slow upstream that never SYN-ACKs). 12 s is
 * comfortable for healthy providers serving from cold caches while
 * still failing fast on a dead endpoint. Surfaced as a friendly
 * "request timed out" via `classifyProviderError` for non-2xx
 * responses, or a plain `Network error` for transport-layer aborts.
 */
export const MODEL_DISCOVERY_TIMEOUT_MS = 12_000;

/** Orchestrator limits. */
/**
 * Concurrency cap for `runSubAgentPool`. Raised from 4 to 8 so a single
 * delegation round of 6-8 specs runs in true parallel instead of
 * queueing the tail behind 4 active workers. The original cap was a
 * defensive guess from the streaming-rate-limit era; modern providers
 * comfortably serve 8 parallel streams per key, and the in-process
 * LCS / file-read cost is bounded by `DiffWorkerPool` (single worker)
 * + `createInlineFileCache` (round-shared). Specs over the cap still
 * queue behind a worker slot — see `Pending` vs `queued` distinction
 * surfaced in the renderer (`SubAgentSnapshot.queued`).
 */
export const MAX_PARALLEL_SUBAGENTS = 8;

/**
 * Upper bound for awaiting a prior run's settlement latch on supersede.
 * Prevents `chat:send` from blocking forever when `settleRun` is never called.
 */
export const RUN_SETTLEMENT_TIMEOUT_MS = 120_000;
export const MAX_SELF_CORRECTION_ATTEMPTS = 3;
export const MAX_TOTAL_ITERATIONS = 24;

/**
 * Delegation 3-strike threshold. Promoted from the magic literal `3`
 * that previously lived inside `handleDelegates.ts` so the value is
 * citable from a single named export and surfaceable to the model via
 * `<runtime_limits>`. Tracks the count of consecutive delegation rounds
 * whose verdicts are ALL `failed` or `malformed`; reset to 0 by any
 * round with at least one `ok` / `partial` verdict, and (per the
 * runLoop's cross-counter reset symmetry) by a successful direct-tool
 * round.
 *
 * Numerically aligned with `MAX_SELF_CORRECTION_ATTEMPTS` because both
 * encode the same "three strikes and escalate" rule the harness §C
 * states explicitly. They are kept as separate exports because they
 * govern semantically different counters: one is direct-tool /
 * transport / orchestrator-iteration self-correction, the other is
 * sub-agent verification — a future tuning pass may want to diverge.
 */
export const MAX_DELEGATION_BAD_ROUNDS = 3;

/**
 * Hard cap on the number of files a single `<delegate files="..." />`
 * directive can list. The model controls this attribute, so without a
 * cap a buggy or pathological turn could emit a directive with
 * thousands of paths and trigger that many parallel `realpath` +
 * `access` probes through `classifyFiles` — a soft DoS on the main
 * process FS surface (review finding H4).
 *
 * 32 is comfortably above the harness §B "Keep this list minimal"
 * guidance and the largest legitimate delegations observed in
 * production transcripts (typically ≤ 8). Excess paths are surfaced
 * to the renderer via `subagent-spawn.missingFiles` with a synthetic
 * "list-cap exceeded" placeholder so the user sees the truncation.
 *
 * Tunable: increase this only after observing a real workflow that
 * legitimately needs > 32 files per directive AND auditing the
 * inline-files token cost. The combined `INLINE_FILE_CHAR_CAP` budget
 * in `contextManager.inlineFiles` will already truncate the body —
 * raising the file count just trades file diversity for per-file
 * tokens.
 */
export const MAX_FILES_PER_DELEGATE = 32;

/**
 * Per-task delegation strike threshold. Independent of
 * `MAX_DELEGATION_BAD_ROUNDS`, which only counts rounds where EVERY
 * verdict is bad: a sub-task that fails repeatedly while paired with
 * an unrelated sibling that succeeds was previously invisible to the
 * round-level counter (the `allBad` reset cleared the streak after
 * every mixed round). The conversation captured at
 * `e6859f7b-fd35-4a43-ae1d-6cd06f17831c.jsonl` (May 16, 2026) shows
 * `App.tsx` edits failing across four sub-agents (D1 → D1_retry →
 * ...) while siblings reported success, never tripping the round
 * halt.
 *
 * This counter is keyed by a stable signature of the sub-agent's
 * task (first 80 chars of the task string + sorted files list). When
 * any key crosses the threshold the orchestrator surfaces a
 * `failing_tasks` hint in `<run_state>` and emits a `phase` divider —
 * the model is expected to pivot decomposition. The round-level halt
 * still fires when every verdict is bad, so this counter is a softer
 * "you are wasting your budget on this task" signal, not a hard halt.
 */
export const MAX_PER_TASK_BAD_STREAK = 3;

/**
 * Planning-without-action nudge budget (T1-5).
 *
 * Cap on the number of times the host injects a `role:'user'` nudge
 * when the orchestrator emits a turn of pure reasoning (no output
 * text, no tool call, no `<delegate />` directive). Lifted to the
 * shared constants module so the harness `<runtime_limits>` block
 * and the run-state surface read from one place — the previous
 * location next to its consumer in `handleNoToolNoDelegate.ts` was
 * the only `MAX_*` knob NOT in this file, breaking the single-
 * source-of-truth contract every other cap honors.
 *
 * `handleNoToolNoDelegate.ts` re-exports this constant for
 * backward compatibility with existing test/import sites.
 */
export const MAX_NUDGES_PER_RUN = 2;

/**
 * Sub-agent loop limits.
 *
 * Hard cap on a single sub-agent's iteration count. The audit-pass
 * subtraction dropped the previous "main cap = 16, wrap-up = +1"
 * surface in favor of a flat 14 and a stronger sub-agent prompt that
 * says "your last action MUST be a `<result>` envelope, not another
 * tool call". The model is expected to self-budget using the
 * `<run_state>` envelope; if it spends 13 iterations on exploration and
 * skips the result, that is a `failed` verdict — not an extra round of
 * host-side coaxing.
 *
 * Lifted to the shared constants module so the harness `<runtime_limits>`
 * block, the `SubAgent` runtime, and any future telemetry surface read
 * from one place. Same single-source-of-truth contract as the other
 * `MAX_*` knobs.
 */
export const SUBAGENT_MAX_ITERATIONS = 14;

/**
 * Iteration index (0-based) at which a sub-agent flips its tool-choice
 * directive from `'auto'` → `'none'` for the *next* provider request.
 * The flip forces the provider to emit prose instead of more tool
 * calls, making the harness rule "your last action MUST be a `<result>`
 * envelope" enforceable at the wire level instead of advisory in the
 * prompt. Set so the wrap-up turn is the LAST iteration before the
 * cap (`SUBAGENT_MAX_ITERATIONS - 1`); the previous penultimate
 * iteration is the natural place for the model to stop calling tools
 * and stage its final answer.
 */
export const SUBAGENT_WRAPUP_ITER = SUBAGENT_MAX_ITERATIONS - 1;

/** Backoff. */
export const BASE_BACKOFF_MS = 250;
export const MAX_BACKOFF_MS = 8000;

/**
 * Provider stream inactivity timeout.
 *
 * If no bytes arrive on the streaming response within this window, the
 * provider fetch is aborted with a dedicated `StreamInactivityError`
 * (see `src/main/providers/streamInactivity.ts`). The orchestrator's
 * self-correction path then treats it like any retriable transport
 * failure and re-issues the request with exponential backoff.
 *
 * Without this guard, a TCP connection held open by a misbehaving
 * provider with no SSE frames turns into an indefinite "Awaiting first
 * token…" in the UI — only resolvable by the user hitting Stop.
 */
export const STREAM_INACTIVITY_TIMEOUT_MS = 60_000;

/**
 * Delta-coalescing threshold for persisted streaming events.
 *
 * The chat IPC emits every `agent-text-delta`/`agent-reasoning-delta`
 * individually to the renderer for smooth streaming, but coalesces them
 * into larger persisted JSONL rows once the buffered text reaches this
 * many characters (or on the matching `*-end`/`*-aborted` event). A
 * 5 000-token response drops from ~5 000 `fs.appendFile` calls to
 * ~20 — dramatically reducing disk-sync pressure under OneDrive /
 * cloud-synced userData on Windows. The reducer sums deltas during
 * replay so the coalesced row is functionally identical.
 */
export const PERSIST_DELTA_COALESCE_CHARS = 256;

/**
 * Context-summarization tunables — single source of truth for the
 * orchestrator-side summarization layer. Mirror the build-time
 * defaults in `@shared/types/contextSummary.ts` so the runtime can
 * read them either by name (here) or via
 * `DEFAULT_CONTEXT_SUMMARY_RULES` (over there) and never drift.
 *
 * The split exists because the rules struct is a runtime-resolvable
 * shape (layered global ← workspace ← session, surfaced into the
 * Inspector) while these constants are import-time-frozen knobs
 * referenced from the harness `<runtime_limits>` block and from
 * the IPC channel registry. Keeping both eliminates "what's the
 * actual default?" ambiguity at the call site.
 */
export const CONTEXT_SUMMARY_DEFAULT_TRIGGER_RATIO = 0.7;
export const CONTEXT_SUMMARY_DEFAULT_KEEP_RECENT_TURNS = 4;
export const CONTEXT_SUMMARY_MIN_MESSAGES_TO_SUMMARIZE = 6;
export const CONTEXT_SUMMARY_DEFAULT_MAX_RETRIES = 2;
/** Default absolute token count before the timeline budget-warning row appears. */
export const TOKEN_BUDGET_WARNING_DEFAULT_TOKENS = 128_000;
/**
 * Legacy ratio fallback when no absolute threshold is configured. Kept
 * for tests and callers that pass only `contextWindow` without a
 * settings-backed threshold.
 */
export const TOKEN_BUDGET_WARNING_DEFAULT_RATIO = 0.7;
/**
 * Filename of the optional per-workspace summarizer-prompt override.
 * Placed at `<workspace>/.vyotiq/context-summarizer.md`. When present
 * and readable, it FULLY replaces the bundled
 * `src/main/harness/05-context-summarizer.md` body — same convention
 * as Cursor / Continue projects use for per-repo agent prompts. The
 * file is never auto-written by the app.
 */
export const CONTEXT_SUMMARY_OVERRIDE_FILENAME = 'context-summarizer.md';
/**
 * Hard cap on the synthesized summary's text length in the persisted
 * JSONL. Prevents a runaway summarizer from writing a multi-MB
 * `context-summary-end.finalText` that bloats every transcript reload
 * across the conversation's lifetime. The renderer + reducer
 * truncate to the same cap on the live path so over-budget streams
 * are clipped at the boundary without further loss.
 */
export const CONTEXT_SUMMARY_MAX_FINAL_CHARS = 32_000;

/**
 * Hard cap on the size of a `chat:send` user prompt (Audit fix M-03).
 * The orchestrator already truncates oversized OpenAI inputs, but a
 * direct-IPC caller could otherwise push an arbitrarily large blob
 * through the `appendEvent` chain and into the persisted JSONL
 * before any provider-side limit kicks in. 1 MiB is comfortably
 * larger than any reasonable interactive prompt (~250k characters)
 * while keeping the renderer's `user-prompt` event under the
 * `MAX_TIMELINE_EVENT_BYTES` envelope plus headroom for metadata.
 *
 * The renderer's chat composer also enforces a smaller UI-level cap;
 * this constant is the host-side last-line-of-defence so a malicious
 * or buggy IPC caller can't bypass the UI gate.
 */
export const MAX_USER_PROMPT_BYTES = 1_048_576; // 1 MiB

/** Max attachments per message (composer shows N/10). */
export const MAX_CHAT_ATTACHMENTS = 10;

/** Per-file size cap for external attachment ingest (10 MB). */
export const MAX_ATTACHMENT_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Prefix for synthetic run ids used by idle-mode manual summarization.
 * Not registered in main `activeRuns` — cancel via
 * `CONTEXT_SUMMARY_ABORT_IDLE`, not `CHAT_ABORT`.
 */
export const IDLE_SUMMARY_RUN_ID_PREFIX = 'idle-summary-';

/** Tool execution. */
export const BASH_TIMEOUT_MS = 30_000;
/** Upper bound for per-invocation `timeoutMs` overrides from the model. */
export const BASH_MAX_TIMEOUT_MS = 30 * 60 * 1000;
export const READ_MAX_BYTES = 512 * 1024; // 512 KB

/**
 * Bash mutation snapshotting caps.
 *
 * The `bash` tool takes a best-effort pre-snapshot of every text file
 * under the workspace (excluding the usual heavy dirs — `node_modules`,
 * `.git`, `dist`, etc.) BEFORE spawning the shell command. After the
 * command exits and the mtime-diff surfaces the changed paths, the
 * tool records a reversible `checkpoint-entry` for every text file we
 * have a pre-body for — so `sed -i`, `> file`, `rm`, `mv` etc. become
 * revertable through the same Accept / Reject / Revert UI the
 * `edit` / `delete` tools feed.
 *
 * The three caps below exist to keep the pre-scan from turning a
 * single bash call into a multi-second walk on a heavy workspace:
 *
 *   - `BASH_SNAPSHOT_MAX_ENTRIES` — total file count we'll even look
 *     at. Hitting the cap flips the remainder to audit-only
 *     (`checkpoint-bash-mutation` row, non-reversible).
 *   - `BASH_SNAPSHOT_MAX_BYTES_PER_FILE` — skip individual files
 *     larger than this. Revert is possible but the blob store would
 *     balloon on a single 50 MiB text file; we treat those as
 *     audit-only too.
 *   - `BASH_SNAPSHOT_MAX_TOTAL_BYTES` — aggregate budget across the
 *     whole pre-scan. First hit wins; everything after is audit-only.
 *
 * The defaults are tuned for a typical source workspace — adjust
 * only after measuring a real regression, not speculatively.
 */
export const BASH_SNAPSHOT_MAX_ENTRIES = 500;
export const BASH_SNAPSHOT_MAX_BYTES_PER_FILE = 512 * 1024; // 512 KiB per file
export const BASH_SNAPSHOT_MAX_TOTAL_BYTES = 8 * 1024 * 1024; // 8 MiB total
/**
 * When a workspace walk sees more than this many files, skip capturing
 * pre-snapshot bodies (mtime-only + audit-only mutations). Avoids pinning
 * memory on monorepos while still surfacing that bash touched paths.
 */
export const BASH_SNAPSHOT_HUGE_TREE_FILES = 50_000;

/** IPC channel names — single source of truth. */
export const IPC = {
  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE_TOGGLE: 'window:maximize-toggle',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',
  WINDOW_STATE_CHANGED: 'window:state-changed',
  WINDOW_RELOAD: 'window:reload',
  WINDOW_TOGGLE_DEVTOOLS: 'window:toggle-devtools',

  // Workspace (single active — preserved for back-compat title bar / tools)
  WORKSPACE_GET: 'workspace:get',
  WORKSPACE_PICK: 'workspace:pick',
  /** Open the folder picker and return a path without activating a workspace. */
  WORKSPACE_PICK_DIRECTORY: 'workspace:pick-directory',
  WORKSPACE_SET: 'workspace:set',
  WORKSPACE_LIST_TREE: 'workspace:list-tree',
  // Workspaces registry (multi)
  WORKSPACES_LIST: 'workspaces:list',
  WORKSPACES_ADD: 'workspaces:add',
  WORKSPACES_SET_ACTIVE: 'workspaces:set-active',
  WORKSPACES_RENAME: 'workspaces:rename',
  WORKSPACES_REMOVE: 'workspaces:remove',
  /**
   * Re-stat a workspace's path and clear its `unreachable` flag if the
   * mount has come back. Returns the refreshed `WorkspacesState` so the
   * renderer can paint the cleared-state badge in one round-trip.
   * Triggered from the sidebar's per-group warning chip.
   */
  WORKSPACES_RETRY_REACHABILITY: 'workspaces:retry-reachability',

  // Providers
  PROVIDERS_LIST: 'providers:list',
  PROVIDERS_ADD: 'providers:add',
  PROVIDERS_UPDATE: 'providers:update',
  PROVIDERS_REMOVE: 'providers:remove',
  PROVIDERS_DISCOVER_MODELS: 'providers:discover-models',
  PROVIDERS_TEST: 'providers:test',
  /**
   * Persist a per-model context-window override on a provider. Pass
   * `value: null` to clear the override and fall back to the value
   * discovered via /v1/models (if any).
   */
  PROVIDERS_SET_CONTEXT_OVERRIDE: 'providers:set-context-override',

  // Tokens (pre-flight BPE estimate for the composer)
  TOKENS_ESTIMATE: 'tokens:estimate',

  // Chat / orchestrator
  CHAT_SEND: 'chat:send',
  CHAT_ABORT: 'chat:abort',
  CHAT_EVENT: 'chat:event',
  CHAT_DONE: 'chat:done',
  CHAT_ERROR: 'chat:error',
  /**
   * Snapshot of orchestrator runs currently in flight in main. The
   * renderer calls this once at boot (post `bootstrapChatChannel`) to
   * rehydrate its `runIdToConv` dispatch table after a renderer reload
   * (HMR / F5). Without it, live runs in main keep streaming events
   * with `runId`s the renderer no longer recognises and `applyEvent`
   * silently drops them. See plan §2.4.
   */
  CHAT_LIST_ACTIVE_RUNS: 'chat:list-active-runs',

  // Context summarization
  /**
   * Snapshot the orchestrator's current `messages[]` for a run (or
   * the persisted initial-messages state for an idle conversation)
   * into a `ContextInspectorSnapshot` the Inspector renders. Cheap
   * O(N) over a Map that's typically ≤ a few dozen entries.
   */
  CONTEXT_SUMMARY_INSPECT: 'context-summary:inspect',
  /**
   * Fire a manual summarization right now. Resolves once the
   * `context-summary-pending` event has been emitted (the actual
   * streaming continues asynchronously and arrives through the
   * existing `CHAT_EVENT` channel). Returns `{ ok: false, reason }`
   * when the run is unknown / disabled / mid-summary / has no
   * summarizable messages.
   */
  CONTEXT_SUMMARY_TRIGGER_MANUAL: 'context-summary:trigger-manual',
  /**
   * Revert the splice for a specific summaryId. Only valid until
   * the next `user-prompt` lands (turn boundary) — after that the
   * snapshot is GC'd and the IPC returns `{ ok: false }`.
   */
  CONTEXT_SUMMARY_UNDO: 'context-summary:undo',
  /**
   * Cancel an in-flight idle-mode summarization for a conversation.
   * Routes through `idleSummaryRuntime.abortIdleSummary`; the
   * streaming path emits a persisted `context-summary-aborted` event.
   */
  CONTEXT_SUMMARY_ABORT_IDLE: 'context-summary:abort-idle',
  /** Cancel in-flight summarization on an active orchestrator run only. */
  CONTEXT_SUMMARY_ABORT_LIVE: 'context-summary:abort-live',
  /**
   * Set / clear a per-message override on a conversation. Persisted
   * as a `context-override-set` TimelineEvent in the JSONL so
   * overrides survive renderer reloads and app restarts. Pass
   * `override: null` to clear.
   */
  CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE: 'context-summary:set-message-override',
  /**
   * Clear ALL per-message overrides on a conversation. Emits a
   * single `context-override-set` event with the synthetic
   * `messageId: '*'` sentinel so replay can reconstruct the same
   * state.
   */
  CONTEXT_SUMMARY_RESET_MESSAGE_OVERRIDES: 'context-summary:reset-message-overrides',
  /**
   * Read the resolved `ContextSummaryRules` (global ← workspace ←
   * session). Used by the Settings → Context tab and the Inspector
   * to surface what's currently in effect for the active workspace.
   */
  CONTEXT_SUMMARY_GET_RULES: 'context-summary:get-rules',
  /**
   * Persist a partial rules patch at the given scope. The IPC
   * handler routes through `settingsStore.setSettings` for both
   * scopes — `global` writes `contextSummary`, `workspace` writes
   * `ui.contextSummaryByWorkspace[wsId]`. Returns the refreshed
   * AppSettings.
   */
  CONTEXT_SUMMARY_UPDATE_RULES: 'context-summary:update-rules',
  /**
   * main → renderer broadcast: emitted whenever a run's
   * inspector snapshot changes (a turn advanced, an override was
   * written, a summary applied). Carries `runId` so the renderer
   * can refetch only when the open Inspector is bound to the
   * affected run. Throttled at the source — at most one emit per
   * RAF-frame per run.
   */
  CONTEXT_SUMMARY_SNAPSHOT_CHANGED: 'context-summary:snapshot-changed',

  // Tools (mixed direction — see per-channel comments below)
  /** renderer → main: open a workspace-relative path in the OS default opener. */
  TOOLS_OPEN_PATH: 'tools:open-path',
  /**
   * main → renderer (broadcast): the orchestrator / a sub-agent is
   * asking the user to confirm a gated action (write, bash, web search).
   * Carries `{ id, message }`. The renderer renders an inline confirm
   * UI and replies via `TOOLS_CONFIRM_RESPONSE`. See `confirmBus.ts`.
   */
  TOOLS_REQUEST_CONFIRM: 'tools:request-confirm',
  /** renderer → main: reply to a `TOOLS_REQUEST_CONFIRM` with the user's choice. */
  TOOLS_CONFIRM_RESPONSE: 'tools:confirm-response',
  /**
   * main → renderer (broadcast): emitted when a pending confirm request
   * resolves WITHOUT a renderer reply (server-side timeout, shutdown
   * drain). The renderer drops the matching pending dialog so it never
   * lingers visible after main has already failed-closed the request.
   */
  TOOLS_CANCEL_CONFIRM: 'tools:cancel-confirm',
  /** renderer → main: re-execute a settled read/search/bash/ls tool call. */
  TOOLS_RERUN: 'tools:rerun',

  // Memory
  MEMORY_LIST: 'memory:list',
  MEMORY_READ: 'memory:read',
  MEMORY_WRITE: 'memory:write',
  MEMORY_REVEAL: 'memory:reveal',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // Conversations (persistent transcripts)
  CONVERSATIONS_LIST: 'conversations:list',
  CONVERSATIONS_READ: 'conversations:read',
  CONVERSATIONS_CREATE: 'conversations:create',
  CONVERSATIONS_RENAME: 'conversations:rename',
  CONVERSATIONS_REMOVE: 'conversations:remove',
  /**
   * Move a conversation under a different workspace. Aborts any
   * in-flight runs pinned to it (re-pinning workspaceId mid-run would
   * silently swap the orchestrator's sandbox), updates the meta's
   * `workspaceId`, and returns the refreshed meta. Used by the
   * sidebar's drag-between-workspaces affordance.
   */
  CONVERSATIONS_MOVE: 'conversations:move',
  CONVERSATIONS_ARCHIVE: 'conversations:archive',
  CONVERSATIONS_UNARCHIVE: 'conversations:unarchive',

  // Checkpoints (file-change review + revert)
  /** Returns the workspace summary (runs, files, usage). */
  CHECKPOINTS_SUMMARY: 'checkpoints:summary',
  /** Returns a full run manifest with all entries. */
  CHECKPOINTS_READ_RUN: 'checkpoints:read-run',
  /** Returns a single file's compact history. */
  CHECKPOINTS_READ_FILE_HISTORY: 'checkpoints:read-file-history',
  /** Returns the pending change list for one conversation. */
  CHECKPOINTS_LIST_PENDING: 'checkpoints:list-pending',
  /** Accepts (drops from pending) — history unchanged. */
  CHECKPOINTS_ACCEPT: 'checkpoints:accept',
  /** Accepts every pending entry for a conversation. */
  CHECKPOINTS_ACCEPT_ALL: 'checkpoints:accept-all',
  /** Rejects one entry — reverts AND drops from pending. */
  CHECKPOINTS_REJECT: 'checkpoints:reject',
  /** Reverts a single entry by id (no pending interaction). */
  CHECKPOINTS_REVERT_ENTRY: 'checkpoints:revert-entry',
  /** Reverts an entire run by replaying its entries in reverse. */
  CHECKPOINTS_REVERT_RUN: 'checkpoints:revert-run',
  /** Reverts one file to a specific content hash from its history. */
  CHECKPOINTS_REVERT_FILE_TO_HASH: 'checkpoints:revert-file-to-hash',
  /** Reads the raw content blob (UTF-8) for a hash — used to preview diffs. */
  CHECKPOINTS_READ_BLOB: 'checkpoints:read-blob',
  /**
   * Reads the CURRENT on-disk contents of a workspace-relative file
   * (UTF-8). Used by `FileHistoryList` to render a "compare with current"
   * diff against any historical snapshot without depending on the
   * generic `read` tool. Returns `null` when the file is absent.
   */
  CHECKPOINTS_READ_CURRENT_FILE: 'checkpoints:read-current-file',
  /** Writes an archive of the workspace's checkpoint store into the workspace root. */
  CHECKPOINTS_EXPORT_ARCHIVE: 'checkpoints:export-archive',
  /** Prune older than N days (`days: 0` clears all). */
  CHECKPOINTS_PRUNE: 'checkpoints:prune',
  /**
   * Delete one specific run + its blob references + any pending rows
   * pointing at the run's entries. Filling the gap between the
   * coarse `PRUNE` (whole workspace, by date) and the per-row revert
   * surfaces. The run's on-disk audit trail is gone after this; the
   * Checkpoints view exposes it as a per-row `Delete` affordance.
   */
  CHECKPOINTS_DELETE_RUN: 'checkpoints:delete-run',
  /**
   * Compute the impact of rewinding a conversation to before a
   * specific `user-prompt` event WITHOUT performing the rewind.
   * Returns the affected run ids, file changes that would be
   * reverted, and the count of transcript events that would be
   * trimmed. The renderer drives the inline confirmation modal off
   * this snapshot.
   */
  CHECKPOINTS_PREVIEW_REWIND: 'checkpoints:preview-rewind',
  /**
   * Atomically revert every file change AND trim every transcript
   * event from the named `user-prompt` onward. The renderer's
   * inline-on-prompt Revert button calls this after the user
   * confirms the modal preview.
   */
  CHECKPOINTS_REWIND_TO_PROMPT: 'checkpoints:rewind-to-prompt',
  /** Unified diff vs git ref (default HEAD) for one file. */
  CHECKPOINTS_GIT_BASE_DIFF: 'checkpoints:git-base-diff',
  CHECKPOINTS_LIST_GIT_REFS: 'checkpoints:list-git-refs',
  CHECKPOINTS_CHANGED: 'checkpoints:changed',
  /**
   * main → renderer (broadcast). Emitted when a conversation's
   * transcript was rewritten in place (currently only from
   * `rewindToPrompt`). Carries the conversation id so the renderer
   * can refresh its cached event slice without polling.
   */
  CONVERSATION_TRANSCRIPT_REWOUND: 'conversation:transcript-rewound',

  // App info (version + on-disk paths shown in About tab)
  /**
   * Returns a small JSON snapshot of the app's version + the data /
   * settings / log directories it's reading from. Surfaced in the
   * Settings → About tab so a user (or someone helping with support /
   * backup) can find their config without digging through Electron's
   * userData conventions.
   */
  APP_INFO_GET: 'app:info:get',
  /**
   * Reveal an absolute path in the OS file manager. Whitelisted in the
   * handler to the same three paths returned by `APP_INFO_GET`
   * (`userDataDir`, `settingsFile`, `logDir`) so the channel can't be
   * abused to open arbitrary filesystem locations.
   */
  APP_REVEAL_PATH: 'app:reveal-path',
  APP_SET_THEME_SOURCE: 'app:set-theme-source',
  APP_CHECK_UPDATES: 'app:check-updates',
  /** Play the OS warning / exclamation sound (destructive confirm UX). */
  APP_PLAY_WARNING_SOUND: 'app:play-warning-sound',

  ATTACHMENTS_PICK: 'attachments:pick',
  ATTACHMENTS_INGEST_PATHS: 'attachments:ingest-paths',
  ATTACHMENTS_READ_TEXT: 'attachments:read-text',
  ATTACHMENTS_FILE_URL: 'attachments:file-url',
  ATTACHMENTS_OPEN: 'attachments:open',

  // Renderer → main log relay (error boundary, etc.)
  RENDERER_LOG: 'renderer:log'
} as const;
