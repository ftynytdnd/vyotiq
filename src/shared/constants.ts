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

/** Host implicit-finish prose thresholds (mirrored in harness `<runtime_limits>`). */
export const IMPLICIT_FINISH_MIN_CHARS = 28;
export const IMPLICIT_FINISH_MIN_SENTENCE_CHARS = 10;

/** Reversible context compaction — see `docs/context-management-design.md`. */
export const COMPACT_MIN_TOOL_OUTPUT_CHARS = 4_000;
/**
 * Minimum chars of a stored tool-CALL argument body before it is worth
 * offloading to disk (host-side equivalent of Anthropic `clear_tool_inputs`).
 * Tool arguments below this rarely move the needle and churning them breaks
 * the prompt cache for no gain.
 */
export const COMPACT_MIN_TOOL_INPUT_CHARS = 4_000;
/**
 * Unified context-window management defaults (2026 context-engineering
 * research: manage proactively well before the hard limit to avoid
 * "context rot"; reversible reduction first, lossy summarization last).
 * See `docs/context-management-design.md`.
 */
/** Fraction of the model context window at which proactive reduction triggers. */
export const CONTEXT_DEFAULT_TRIGGER_FRACTION = 0.75;
/** Fraction of the model context window at which the UI shows an early warning. */
export const CONTEXT_DEFAULT_WARN_FRACTION = 0.7;
/** Most-recent tool results kept verbatim when clearing older ones. */
export const CONTEXT_DEFAULT_KEEP_LAST_TOOL_RESULTS = 3;
/** Minimum tokens a reduction pass must free, else it is skipped (protects the prompt cache). */
export const CONTEXT_DEFAULT_MIN_SAVINGS_TOKENS = 2_000;
/** Cooldown between automatic reduction passes for one run (anti-thrash). */
export const CONTEXT_DEFAULT_COOLDOWN_MS = 15_000;
/**
 * Absolute compaction warn/trigger caps for large-window models. Display and
 * meter % use the full discovered window; proactive reduction uses
 * min(fraction × window, absolute) so 1M models still compact near ~200k.
 */
export const CONTEXT_ABSOLUTE_COMPACTION_WARN_TOKENS = 180_000;
export const CONTEXT_ABSOLUTE_COMPACTION_TRIGGER_TOKENS = 200_000;
/**
 * History-layer bands for large-window models: when transcript history alone
 * dominates the prompt, warn/trigger even if total tokens sit below the
 * absolute caps (e.g. 119k history at 133k total on a 1M window).
 */
export const CONTEXT_HISTORY_COMPACTION_WARN_TOKENS = 100_000;
export const CONTEXT_HISTORY_COMPACTION_TRIGGER_TOKENS = 120_000;
/** Clamp band for provider-vs-estimate calibration (real ÷ heuristic). */
export const CONTEXT_CALIBRATION_MIN = 0.5;
export const CONTEXT_CALIBRATION_MAX = 2;
/** Subfolder under WORKSPACE_DOTDIR for reversible pre-summary transcripts. */
export const CONTEXT_SUMMARY_SUBDIR = 'context-summaries';

/** Default per-run wall-clock budget when enabled (30 minutes). */
export const DEFAULT_RUN_WALL_CLOCK_BUDGET_MS = 30 * 60 * 1000;

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

/** Subdirectory under Electron `userData` for all Vyotiq-owned files. */
export const VYOTIQ_DATA_DIR_NAME = 'vyotiq';

/** Filenames inside {@link VYOTIQ_DATA_DIR_NAME}. */
export const GLOBAL_META_FILE = 'meta-rules.md';
export const PROVIDERS_FILE = 'providers.encrypted.json';
export const SETTINGS_FILE = 'settings.json';

/** Model discovery cache TTL (ms). */
export const MODEL_DISCOVERY_TTL_MS = 5 * 60 * 1000;

/** Background provider account poll interval while UI is actively viewing billing (ms). */
export const PROVIDER_ACCOUNT_POLL_ACTIVE_MS = 5_000;

/** Background provider account poll interval when idle (ms). */
export const PROVIDER_ACCOUNT_POLL_IDLE_MS = 60_000;

/** Per-fetch wall-clock budget for provider account requests. */
export const PROVIDER_ACCOUNT_TIMEOUT_MS = 10_000;

/** USD fallback threshold below which account snapshots flag `lowBalance`. */
export const PROVIDER_LOW_BALANCE_USD = 1;

/** Low-balance warning when balance falls below this fraction of last top-up / peak balance. */
export const PROVIDER_LOW_BALANCE_PERCENT = 0.1;

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

/** Agent loop limits. */
/**
 * Upper bound for awaiting a prior run's settlement latch on supersede.
 * Prevents `chat:send` from blocking forever when `settleRun` is never called.
 */
export const RUN_SETTLEMENT_TIMEOUT_MS = 120_000;
export const MAX_SELF_CORRECTION_ATTEMPTS = 3;
/** Harness recovery cycles before a sustained provider failure terminates the run. */
export const MAX_PROVIDER_RECOVERY_ROUNDS = 1;
export const MAX_TOTAL_ITERATIONS = 24;

/** Default per-subtask phase-cycle convergence guard (soft cap). */
export const DEFAULT_PHASE_CYCLE_CAP = 8;

/**
 * Iterations of headroom the phased soft global-iteration cap keeps below the
 * hard `MAX_TOTAL_ITERATIONS` ceiling. The phased escape hatch ("ask the
 * human") must surface *before* the loop's forced-synthesis fallback, so the
 * soft cap trips this many iterations early rather than coinciding with — and
 * being masked by — the hard cap.
 */
export const PHASED_SOFT_ITERATION_MARGIN = 2;

/** Host acceptance-test runner timeout during VERIFY phase (ms). */
export const PHASE_VERIFY_TIMEOUT_MS = 120_000;

/** Min / max configurable VERIFY acceptance-command timeout (seconds). */
export const PHASE_VERIFY_TIMEOUT_MIN_S = 10;
export const PHASE_VERIFY_TIMEOUT_MAX_S = 600;

/**
 * Max chars of acceptance-test output persisted inside a `phase-gate`
 * durable snapshot. Keeps the append-only JSONL ledger bounded for
 * always-on desktop sessions.
 */
export const VERIFY_EVIDENCE_PERSIST_CHARS = 2_000;

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
 * Shorter inactivity budget while waiting for HTTP response headers.
 * After `onConnect`, transports extend to `STREAM_INACTIVITY_TIMEOUT_MS`.
 */
export const PRE_HEADER_STREAM_INACTIVITY_MS = 25_000;

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
/**
 * Cap for detached server-start rewrites (Ollama serve, etc.) — long enough
 * for a health probe, short enough that a blocking mistake cannot stall a run.
 */
export const BASH_SERVER_START_TIMEOUT_MS = 20_000;
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

  // Workspace
  /** Open the folder picker and return a path without activating a workspace. */
  WORKSPACE_PICK_DIRECTORY: 'workspace:pick-directory',
  WORKSPACE_LIST_TREE: 'workspace:list-tree',
  WORKSPACE_LIST_CHILDREN: 'workspace:list-children',
  WORKSPACE_GIT_STATUS: 'workspace:git-status',
  /** Push: workspace filesystem changed (main → renderer). */
  WORKSPACE_TREE_CHANGED: 'workspace:tree-changed',
  WORKSPACE_MKDIR: 'workspace:mkdir',
  WORKSPACE_RENAME_PATH: 'workspace:rename-path',
  WORKSPACE_DELETE_PATH: 'workspace:delete-path',
  WORKSPACE_REVEAL_PATH: 'workspace:reveal-path',
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
  /** Push: latest provider account snapshots (main → renderer). */
  PROVIDERS_ACCOUNT_UPDATED: 'providers:account-updated',
  PROVIDERS_GET_ACCOUNTS: 'providers:get-accounts',
  PROVIDERS_REFRESH_ACCOUNTS: 'providers:refresh-accounts',
  /** Renderer toggles poll cadence sources (`model-picker`, `composer`, `settings-providers`). */
  PROVIDERS_SET_ACCOUNT_POLL_SOURCE: 'providers:set-account-poll-source',
  /** Push: refreshed model list for one provider (main → renderer). */
  PROVIDERS_MODELS_UPDATED: 'providers:models-updated',
  PROVIDERS_DISCOVERY_POLL_HINT: 'providers:discovery-poll-hint',

  // Token estimation (main-process BPE / heuristic)
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
  /** Run paused on `ask_user`; renderer may submit answers to resume. */
  CHAT_AWAITING_USER: 'chat:awaiting-user',
  CHAT_SUBMIT_ASK_USER: 'chat:submit-ask-user',

  // Context window management (manual controls)
  /** renderer → main: force a reversible reduction pass on a conversation now. */
  CONTEXT_COMPACT_NOW: 'context:compact-now',
  /** renderer → main: summarize the conversation so far and continue from a lean context. */
  CONTEXT_RESET: 'context:reset',
  /** renderer → main: read the full content of an offloaded reduction artifact. */
  CONTEXT_READ_ARTIFACT: 'context:read-artifact',
  /** renderer → main: evaluate prospective context usage + layer breakdown. */
  CONTEXT_EVALUATE: 'context:evaluate',

  // Tools (mixed direction — see per-channel comments below)
  /** renderer → main: open a workspace-relative path in the OS default opener. */
  TOOLS_OPEN_PATH: 'tools:open-path',
  /** renderer → main: write an auto-generated HTML run summary report. */
  REPORTS_GENERATE_RUN_SUMMARY: 'reports:generate-run-summary',
  /** renderer → main: open a workspace HTML report in the in-app browser window. */
  REPORTS_OPEN: 'reports:open',

  // Memory
  MEMORY_LIST: 'memory:list',
  MEMORY_READ: 'memory:read',
  MEMORY_WRITE: 'memory:write',
  MEMORY_REVEAL: 'memory:reveal',
  /** renderer → main: wipe and rebuild the workspace vector index. */
  MEMORY_REINDEX: 'memory:reindex',
  MEMORY_REINDEX_PROGRESS: 'memory:reindex-progress',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  PROMPT_CACHE_STATUS: 'prompt-cache:status',

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
  /** Increment Vyotiq-estimated spend for a conversation turn (idempotent per prompt). */
  CONVERSATIONS_INCREMENT_SPEND: 'conversations:increment-spend',
  /** Load the newest N events for timeline hydration. */
  CONVERSATIONS_READ_TAIL: 'conversations:read-tail',
  /** Load events strictly before a given event id. */
  CONVERSATIONS_READ_BEFORE: 'conversations:read-before',
  /** Save transcript to disk as JSONL or Markdown. */
  CONVERSATIONS_EXPORT: 'conversations:export',

  /** renderer ↔ main: local scheduled agent runs. */
  SCHEDULED_RUNS_LIST: 'scheduled-runs:list',
  SCHEDULED_RUNS_UPSERT: 'scheduled-runs:upsert',
  SCHEDULED_RUNS_DELETE: 'scheduled-runs:delete',

  // Checkpoints — file-change review + rewind
  CHECKPOINTS_PREVIEW_REWIND: 'checkpoints:preview-rewind',
  CHECKPOINTS_REWIND_TO_PROMPT: 'checkpoints:rewind-to-prompt',
  CHECKPOINTS_LIST_PENDING: 'checkpoints:list-pending',
  CHECKPOINTS_ACCEPT: 'checkpoints:accept',
  CHECKPOINTS_ACCEPT_ALL: 'checkpoints:accept-all',
  CHECKPOINTS_REJECT: 'checkpoints:reject',
  CHECKPOINTS_READ_BLOB: 'checkpoints:read-blob',
  CHECKPOINTS_CHANGED: 'checkpoints:changed',

  // In-app workspace editor
  EDITOR_READ: 'editor:read',
  EDITOR_WRITE: 'editor:write',

  // Workspace PTY terminal (multi-session per workspace)
  TERMINAL_ATTACH: 'terminal:attach',
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_CLOSE: 'terminal:close',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_RESTART: 'terminal:restart',
  TERMINAL_DETACH: 'terminal:detach',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',

  // In-app web browser (Globe) — Electron WebContentsView owned by main
  BROWSER_ATTACH: 'browser:attach',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_RELOAD: 'browser:reload',
  BROWSER_STOP: 'browser:stop',
  BROWSER_SET_BOUNDS: 'browser:set-bounds',
  BROWSER_SET_VISIBLE: 'browser:set-visible',
  BROWSER_FIND: 'browser:find',
  BROWSER_STOP_FIND: 'browser:stop-find',
  BROWSER_OPEN_EXTERNAL: 'browser:open-external',
  /** main → renderer: navigation / loading state for the embedded browser. */
  BROWSER_STATE: 'browser:state',

  // Inline completion (editor FIM + composer continuation)
  COMPLETION_REQUEST: 'completion:request',
  COMPLETION_CANCEL: 'completion:cancel',

  // Language server (editor relay for @codemirror/lsp-client)
  LSP_CONNECT: 'lsp:connect',
  LSP_SEND: 'lsp:send',
  LSP_MESSAGE: 'lsp:message',
  LSP_STATUS: 'lsp:status',
  LSP_DISCONNECT: 'lsp:disconnect',

  // Composer mention search helpers
  MENTIONS_SEARCH_SYMBOLS: 'mentions:search-symbols',

  // Harness overrides (natural-language OS sections)
  HARNESS_LIST_SECTIONS: 'harness:list-sections',
  HARNESS_READ_SECTION: 'harness:read-section',
  HARNESS_WRITE_SECTION: 'harness:write-section',
  HARNESS_RESET_SECTION: 'harness:reset-section',

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
  APP_INSTALL_UPDATE: 'app:install-update',
  /** main → renderer broadcast of electron-updater phase/progress. */
  APP_UPDATE_STATUS: 'app:update-status',
  /** Play the OS warning / exclamation sound (destructive confirm UX). */
  APP_PLAY_WARNING_SOUND: 'app:play-warning-sound',

  ATTACHMENTS_PICK: 'attachments:pick',
  ATTACHMENTS_COLLECT_FOLDER: 'attachments:collect-folder',
  ATTACHMENTS_INGEST_PATHS: 'attachments:ingest-paths',
  ATTACHMENTS_READ_TEXT: 'attachments:read-text',
  ATTACHMENTS_FILE_URL: 'attachments:file-url',
  ATTACHMENTS_OPEN: 'attachments:open',

  // Renderer → main log relay (error boundary, etc.)
  RENDERER_LOG: 'renderer:log'
} as const;

/** Max timeline events loaded into the renderer per conversation slice. */
export const TRANSCRIPT_PAGE_SIZE = 400;
