/**
 * Application-wide constants. Imported by both main and renderer.
 */

import type { ChatPermissions } from './types/chat.js';

export const APP_NAME = 'Vyotiq';
export const AGENT_NAME = 'Agent V';

export const DEFAULT_PERMISSIONS: ChatPermissions = {};

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
 * LCS / file-read cost is bounded by `DiffWorkerPool` (multi-worker pool)
 * + `createInlineFileCache` (round-shared). Specs over the cap still
 * queue behind a worker slot — see `Pending` vs `queued` distinction
 * surfaced in the renderer (`SubAgentSnapshot.queued`).
 */
/** Legacy fallback when the model omits `concurrency` on delegate calls. */
export const DEFAULT_DELEGATE_CONCURRENCY = 32;

/** Hard host ceiling — prevents accidental DoS from runaway delegate fan-out. */
export const HOST_DELEGATE_CONCURRENCY_CEILING = 64;

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
 * Wall-clock cap on a single sub-agent run inside `runSubAgentPool`.
 *
 * Independent of {@link STREAM_INACTIVITY_TIMEOUT_MS}, which only
 * guards idle SSE transport between provider chunks. Slow models can
 * stream steadily yet take many minutes to finish a multi-tool worker;
 * applying the 60 s transport knob here produced false "timed out"
 * failures while tokens were still arriving.
 *
 * Five minutes is long enough for typical delegate tasks on cold /
 * low-throughput endpoints without letting a hung worker pin a pool
 * slot indefinitely (user Stop still wins via `AbortSignal`).
 */
export const SUBAGENT_RUN_TIMEOUT_MS = 300_000;

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
   * Triggered from the dock's per-group warning chip.
   */
  WORKSPACES_RETRY_REACHABILITY: 'workspaces:retry-reachability',

  // Providers
  PROVIDERS_LIST: 'providers:list',
  PROVIDERS_ADD: 'providers:add',
  PROVIDERS_UPDATE: 'providers:update',
  PROVIDERS_REMOVE: 'providers:remove',
  PROVIDERS_DISCOVER_MODELS: 'providers:discover-models',
  PROVIDERS_TEST: 'providers:test',
  // Future: per-model context-window override IPC (not wired yet).

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
  /** Run paused on `ask_user`; renderer may submit answers to resume. */
  CHAT_AWAITING_USER: 'chat:awaiting-user',
  CHAT_SUBMIT_ASK_USER: 'chat:submit-ask-user',

  // Tools (mixed direction — see per-channel comments below)
  /** renderer → main: open a workspace-relative path in the OS default opener. */
  TOOLS_OPEN_PATH: 'tools:open-path',
  /** renderer → main: re-execute a settled read / ls / search / memory tool call. */
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
   * dock's drag-between-workspaces affordance.
   */
  CONVERSATIONS_MOVE: 'conversations:move',
  CONVERSATIONS_ARCHIVE: 'conversations:archive',
  CONVERSATIONS_UNARCHIVE: 'conversations:unarchive',

  // Checkpoints — renderer rewind (recording stays main-only)
  /** Rewind impact preview (inline Revert modal). */
  CHECKPOINTS_PREVIEW_REWIND: 'checkpoints:preview-rewind',
  /** Atomic rewind to a user-prompt boundary. */
  CHECKPOINTS_REWIND_TO_PROMPT: 'checkpoints:rewind-to-prompt',
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
