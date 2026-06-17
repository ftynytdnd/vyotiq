/**

 * Typed IPC contract. The shape of `window.vyotiq` exposed via contextBridge.

 * Both the preload and the renderer import this; the renderer treats it as

 * read-only.

 */



import type { ScheduledRun, ScheduledRunInput } from './scheduledRun.js';
import type {
  ProviderConfig,

  AddProviderInput,

  ProviderAttribution,

  ThinkingEffort,

  ModelInfo

} from './provider.js';

import type { ProviderAccountSnapshotMap } from './providerAccount.js';

import type {

  ChatSendInput,

  ChatSendReply,

  Conversation,

  ConversationMeta,

  TimelineEvent,

  PromptAttachmentMeta

} from './chat.js';

import type { WorkspaceSpendEntry, TurnUsageStatsDelta } from './usageStats.js';

import type { AskUserSubmitInput, AskUserSubmitReply } from './askUser.js';

import type {
  RewindPreviewResult,
  RewindResult,
  PendingChange,
  CheckpointRevertResult
} from './checkpoint.js';





export interface GenerateRunSummaryInput {

  conversationId: string;

  workspaceId: string;

  promptId: string;

  promptPreview: string;

  durationMs: number;

  completedAt: number;

  edits: Array<{ filePath: string; additions: number; deletions: number }>;

  /** Token totals for the run window (optional). */
  usageSummary?: {
    promptTokens: number;
    completionTokens: number;
    cachedPromptTokens?: number;
    cacheCreationTokens?: number;
    reasoningTokens?: number;
  };

  /** Vyotiq-estimated USD for the run. */
  costUsd?: number;

  /** Human-readable model label, e.g. `providerId / modelId`. */
  modelLabel?: string;

}

export type GenerateRunSummaryReply =

  | { ok: true; title: string; relPath: string; bytes: number }

  | { ok: false; error: string };

export interface ReportsOpenInput {

  relPath: string;

  workspaceId?: string;

  title?: string;

}

export type ReportsOpenReply = { ok: true } | { ok: false; error: string };

/** Manual context-management control input (Compact now / Reset context). */
export interface ContextManualInput {

  conversationId: string;

  /** Model to use for token counting + summarization (current composer model). */
  selection: { providerId: string; modelId: string };

}

export type ContextManualReply =

  | { ok: true; changed: boolean; tokensRemoved?: number }

  | {

    ok: false;

    reason: 'unknown-conversation' | 'busy' | 'failed';

    message?: string;

  };

/** Read the full content of an offloaded reduction artifact (timeline restore/view). */
export interface ContextArtifactReadInput {

  conversationId: string;

  /** Workspace-relative artifact path (from a `tool-compacted`/`context-summary` marker). */
  relativePath: string;

}

export type ContextArtifactReadReply =

  | { ok: true; content: string }

  | { ok: false; reason: 'unknown-conversation' | 'not-found' | 'failed'; message?: string };

/** Prospective context-window evaluation for the composer meter (idle / between runs). */
export interface ContextEvaluateInput {
  conversationId?: string;
  workspaceId: string;
  selection: { providerId: string; modelId: string };
  draftPrompt?: string;
  draftAttachmentMeta?: PromptAttachmentMeta[];
}

export type ContextEvaluateReply =
  | { ok: true; usage: import('../context/contextLevel.js').ContextUsageSummary }
  | { ok: false; reason: 'no-workspace' | 'failed'; message?: string };



export interface TokensEstimateInput {

  modelId: string;

  prompt: string;

  attachments?: string[];

  attachmentMeta?: PromptAttachmentMeta[];

  workspacePath?: string;

}



export interface TokensEstimateResult {

  tokens: number;

  exact: boolean;

}



export interface AppSettings {

  defaultModel?: { providerId: string; modelId: string };

  /**

   * Persisted UI state. Kept under a sub-object so future renderer-level

   * preferences (theme, density, etc.) can be added without churning the

   * top-level shape.

   */

  ui?: {

    /** @deprecated Replaced by `dockExpanded`. Read for migration only. */

    sidebarOpen?: boolean;

    /**

     * Left navigation dock expand/collapse. Collapsed by default on

     * first launch; persisted so the user's preference survives restart.

     */

    dockExpanded?: boolean;

    /**

     * Expanded left dock width in px. Default 260; clamped 220–320.

     */

    dockWidth?: number;

    /** Workbench side-pane width in px. Default 480; clamped 320–900. */

    workbenchPaneWidth?: number;

    /** @deprecated Legacy secondary-zone layout flags — ignored after workbench shell. */
    /** Custom keyboard binding overrides (binding id → combo string). */
    keybindings?: Record<string, string>;

    /**

     * Timeline row expand/collapse state keyed by `conversationId`. Each

     * value is an array of opaque row keys (e.g. `tool-group:<id>`) that

     * the user has explicitly expanded. Collapsed is implicit absence.

     * Closed-by-default on first appearance; survives restart.

     */

    expandedRows?: Record<string, string[]>;

    /**

     * Per-workspace last-active conversation id. Lets each workspace

     * remember which session was open when the user switched away, so

     * flipping back restores the prior timeline without aborting any

     * in-flight run. Keyed by `WorkspaceEntry.id`.

     */

    activeConversationByWorkspace?: Record<string, string>;

    /**

     * Sidebar workspace-group expand/collapse state, keyed by

     * `WorkspaceEntry.id`. Open is the default — absence means "expanded".

     */

    collapsedWorkspaces?: string[];

    /**

     * Per-workspace last-used model. When the model picker has no

     * conversation-level preference (`lastProviderId`/`lastModelId` on

     * the active conversation), it falls back to this map keyed by

     * `WorkspaceEntry.id` BEFORE the global `defaultModel` — so a

     * fresh chat in a workspace defaults to the model that workspace

     * was last using rather than the app-wide default.

     */

    lastModelByWorkspace?: Record<string, { providerId: string; modelId: string }>;

    /** Appearance: dark, light, or follow OS. */

    theme?: 'dark' | 'light' | 'system';

    density?: 'compact' | 'balanced' | 'airy';

    reducedMotion?: boolean;

    /** Starred models in the composer picker (`providerId:modelId`). */

    favoriteModels?: string[];

    /**
     * Cumulative estimated API spend (USD) per workspace id.
     * Updated when runs complete and model pricing is available.
     */
    workspaceSpendUsd?: Record<string, WorkspaceSpendEntry>;

    /** Last floating panel widths by panel id. */

    panelWidths?: Record<string, number>;

    /** Per-workspace recently opened editor paths. */

    recentEditorFilesByWorkspace?: Record<string, string[]>;

    /** Per-workspace expanded folder paths in the dock file tree. */

    fileTreeExpandedByWorkspace?: Record<string, string[]>;

    /** Per-workspace open editor tabs restored on workspace activate. */

    editorTabsByWorkspace?: Record<
      string,
      Array<{ filePath: string; active?: boolean }>
    >;

    /** When true, Settings opens on Appearance on next launch only. */

    firstLaunch?: boolean;

    /** Last Settings subnav tab. */

    lastSettingsTab?: string;

    /** Pinned conversation ids shown at the top of the dock list. */

    pinnedConversationIds?: string[];

    /** HTML report deliverables — auto-open, in-app browser, gate, AI footer. */

    reports?: {

      /** Open HTML when a report is ready (default true). */

      autoOpenReports?: boolean;

      /** Use Vyotiq report BrowserWindow vs OS browser (default true). */

      openInAppBrowser?: boolean;

      /** Host ask_user gate after large edit runs without report (default true). */

      promptForReportAfterEdits?: boolean;

      /** Show token-costing "AI report" footer action (default false). */

      enableAiRunSummary?: boolean;

    };

    /** Prompt / context caching diagnostics and provider options. */

    promptCaching?: {

      /** Anthropic cache-diagnostics beta (default false). */

      anthropicCacheDiagnostics?: boolean;

      /** Anthropic cache TTL — `1h` default for long agent sessions. */

      anthropicCacheTtl?: '5m' | '1h';

      /** Force Gemini explicit `cachedContents` (large prefixes also auto-enable). */

      geminiExplicitCache?: boolean;

    };

    /** Tab/ghost inline completion for editor + composer. */

    inlineCompletion?: {

      enabled?: boolean;

      editorEnabled?: boolean;

      composerEnabled?: boolean;

      providerId?: string;

      modelId?: string;

      debounceMs?: number;

    };

    /** Local vector index embedder selection. */

    vectorMemory?: {

      embedder?: 'hash' | 'ollama';

      ollamaBaseUrl?: string;

      ollamaModel?: string;

    };

    /** Optional language-server bridge for the in-app editor. */

    editorLsp?: {

      enabled?: boolean;

      command?: string;

      args?: string[];

      /** Per-language stdio server overrides (languageId → command). */
      languages?: Record<string, { command: string; args?: string[] }>;

    };


    /** Run limits and long-task context options. */

    agentBehavior?: {

      /** Optional cumulative per-run token ceiling. */

      runTokenBudget?: {

        enabled?: boolean;

        maxTotalTokens?: number;

      };

      /**
       * @deprecated Legacy reversible-compaction toggle. Superseded by
       * `contextManagement`. Still read for back-compat: when
       * `contextManagement.enabled` is absent, this flag seeds the master
       * switch. See `docs/context-management-design.md`.
       */

      contextCompaction?: {

        enabled?: boolean;

      };

      /**
       * Unified context-window management (default on). Proactively keeps the
       * prompt under compaction thresholds via reversible
       * reduction, with optional lossy summarization as a last resort. See
       * `docs/context-management-design.md`.
       */

      contextManagement?: {

        enabled?: boolean;

        triggerFraction?: number;

        warnFraction?: number;

        keepLastToolResults?: number;

        summarizationEnabled?: boolean;

        cooldownMs?: number;

        minSavingsTokens?: number;

        /**
         * Optional dedicated model for lossy summarization. When unset, the
         * run's own model summarizes. Lets the user route compaction to a
         * cheaper/faster model.
         */
        summaryModel?: {

          providerId?: string;

          modelId?: string;

        };

        /**
         * Opt-in: use Anthropic's server-side `compact_20260112` compaction as
         * the backstop for Anthropic-dialect runs. Off by default; host-side
         * reduction stays primary.
         */
        serverSideCompaction?: boolean;

      };

      /** Optional per-run wall-clock ceiling. */

      runWallClockBudget?: {

        enabled?: boolean;

        maxDurationMs?: number;

      };

    };

    /** Atomic workspace spend increments (USD) — merged server-side. */

    workspaceSpendIncrement?: Record<string, number>;

    /** Atomic workspace usage increments — merged server-side. */
    workspaceUsageIncrement?: Record<
      string,
      { spendUsd: number } & import('./usageStats.js').TurnUsageStatsDelta
    >;

  };

}



/**

 * A single workspace registered with the app. The user can have many;

 * conversations are stamped with one `workspaceId` and tools/sandbox/

 * memory for a given run resolve through that id (NOT the globally

 * active workspace). That decoupling is what lets a run keep going

 * after the user switches the active workspace.

 */

export interface WorkspaceEntry {

  id: string;

  path: string;

  label: string;

  addedAt: number;

  /**

   * Set on the wire ONLY when main couldn't `fs.stat` the path on the

   * most recent reachability check (boot or explicit retry). The

   * registry entry is preserved so the user can fix the mount and

   * retry — the flag is purely advisory and lets the renderer paint

   * a warning chip on the dock workspace group. Optional in the type so

   * existing settings blobs without the field deserialise unchanged.

   */

  unreachable?: boolean;

}



/**

 * Multi-workspace registry exposed to the renderer. `activeId` is the

 * workspace currently in focus in the UI; `workspaces[]` is the full

 * set the dock tree renders. May be empty on first launch (no

 * workspace picked yet).

 */

export interface WorkspacesState {

  activeId: string | null;

  workspaces: WorkspaceEntry[];

}



/**

 * Snapshot row returned by `chat.listActiveRuns()`. One entry per

 * orchestrator run currently in flight in main. Optional fields are

 * left undefined for runs that haven't bound a conversation /

 * workspace yet (transient pre-binding window inside `startRun`); the

 * renderer skips those entries during rehydration.

 */

export interface ActiveRunInfo {

  runId: string;

  conversationId?: string;

  workspaceId?: string;

  startedAt?: number;

  /** Model id for the run — used to re-seed `runIdToModel` after reload. */

  modelId?: string;

  /** True when the run is paused at an `ask_user` prompt awaiting renderer reply. */

  awaitingUser?: boolean;

}



/**

 * Snapshot of the app's identity + on-disk layout. Surfaced in the

 * Settings → About tab so a user (or anyone helping with support /

 * backup) can find their config and log files without digging through

 * Electron's userData conventions. Plain JSON, no live state — values

 * never change for a given install short of an Electron upgrade or a

 * fresh build.

 */

export interface AppInfo {

  /** Semantic version from `package.json`. */

  version: string;

  /** Electron runtime version (e.g. `28.2.0`). */

  electron: string;

  /** Node version embedded in Electron (e.g. `18.18.2`). */

  node: string;

  /** Vyotiq-owned data directory: `<electronUserData>/vyotiq`. */

  userDataDir: string;

  /** Electron profile root (includes Chromium caches). */

  electronUserDataDir?: string;

  /** Absolute path to `settings.json` inside {@link userDataDir}. */

  settingsFile: string;

  /** Absolute path to the rolling log directory. */

  logDir: string;

}



/**

 * Whitelisted targets for `vyotiq.app.revealPath`. The IPC handler

 * accepts ONLY these enum values (not arbitrary paths) so the channel

 * cannot be abused to open any filesystem location.

 */

export type AppRevealTarget = 'userData' | 'settings' | 'log';



export interface MemoryEntry {

  /** Storage scope. */

  scope: 'global' | 'workspace';

  /** Filename relative to the memory folder, e.g. `user-preferences.md`. */

  key: string;

  /** Markdown contents. */

  content: string;

  /** Last modified ms epoch. */

  updatedAt: number;

  /** Last chat that read or wrote this note (workspace scope). */

  lastReferencedAt?: number;

  lastReferencedConversationId?: string;

  lastReferencedConversationTitle?: string;

}



export interface WorkspaceInfo {

  path: string | null;

  /** Pretty short name for display. */

  label: string | null;

}



/**

 * Result shape for `workspace.listTree`. `entries` is the (capped) list

 * of paths, `total` is the uncapped count the walker actually found, and

 * `truncated` is `true` iff `entries.length < total`. Consumers render

 * the truncation hint ("results truncated, narrow the filter") only when

 * `truncated === true` so small workspaces stay visually silent.

 */

export interface WorkspaceTreeResult {

  entries: string[];

  truncated: boolean;

  total: number;

}

export interface WorkspaceListChildrenInput {
  workspaceId?: string;
  /** Workspace-relative directory; empty string for workspace root. */
  relativeDir: string;
  includeDotfiles?: boolean;
}

export interface WorkspaceListChildrenResult {
  entries: string[];
}

export type GitPathStatus = 'M' | 'A' | 'D' | 'U' | 'R' | '?';

export interface WorkspaceGitStatusResult {
  paths: Record<string, GitPathStatus>;
}

export interface WorkspaceTreeChangedPayload {
  workspaceId: string;
}

export interface WorkspaceMkdirInput {
  workspaceId?: string;
  path: string;
}

export interface WorkspaceRenamePathInput {
  workspaceId?: string;
  from: string;
  to: string;
}

export interface WorkspaceDeletePathInput {
  workspaceId?: string;
  path: string;
  recursive?: boolean;
}

export interface WorkspacePathOpReply {
  ok: true;
}

export interface WorkspaceRevealPathInput {
  workspaceId?: string;
  path: string;
}



/**

 * The renderer-facing API surface. All methods must be plain JSON-safe values.

 * Complex bidirectional streams use event listeners (`onChat*`).

 */

export interface VyotiqApi {

  // ---- Window controls (frameless title bar) ----

  window: {

    minimize(): Promise<void>;

    maximizeToggle(): Promise<void>;

    close(): Promise<void>;

    isMaximized(): Promise<boolean>;

    onStateChanged(cb: (state: { isMaximized: boolean }) => void): () => void;

    reload(): Promise<void>;

    toggleDevTools(): Promise<void>;

  };



  // ---- Workspace ----

  workspace: {

    /**

     * Open the OS folder picker and return the chosen path without

     * adding or activating a workspace (used by the path prompt).

     */

    pickDirectory(): Promise<string | null>;

    listTree(opts?: { depth?: number; workspaceId?: string }): Promise<WorkspaceTreeResult>;

    listChildren(input: WorkspaceListChildrenInput): Promise<WorkspaceListChildrenResult>;

    gitStatus(opts?: { workspaceId?: string }): Promise<WorkspaceGitStatusResult>;



    /** Full multi-workspace registry. Used by the dock tree. */

    list(): Promise<WorkspacesState>;

    /**

     * Add a workspace. If `path` is omitted, opens the OS picker —

     * matches the existing `pick()` UX. The added workspace is also

     * activated. Returns the new entry, or `null` when the picker is dismissed.

     */

    add(path?: string): Promise<WorkspaceEntry | null>;

    /** Activate a workspace by id (already registered). */

    setActive(id: string): Promise<WorkspacesState>;

    /** Rename a workspace's display label (path is immutable). */

    rename(id: string, label: string): Promise<WorkspaceEntry>;

    /**

     * Remove a workspace. Conversations stamped with this id are either

     * deleted (`deleteConversations: true`) or reparented to the

     * synthetic "Unassigned" workspace.

     */

    remove(id: string, opts: { deleteConversations: boolean }): Promise<WorkspacesState>;

    /**

     * Re-stat a workspace's path. If the mount is now reachable, clears

     * its `unreachable` flag in the registry. Returns the refreshed

     * `WorkspacesState` so the renderer can paint the result in a

     * single round-trip.

     */

    retryReachability(id: string): Promise<WorkspacesState>;

    mkdir(input: WorkspaceMkdirInput): Promise<WorkspacePathOpReply>;

    renamePath(input: WorkspaceRenamePathInput): Promise<WorkspacePathOpReply>;

    deletePath(input: WorkspaceDeletePathInput): Promise<WorkspacePathOpReply>;

    revealPath(input: WorkspaceRevealPathInput): Promise<WorkspacePathOpReply>;

    onTreeChanged(cb: (payload: WorkspaceTreeChangedPayload) => void): () => void;

  };



  // ---- Token estimation ----

  tokens: {

    estimate(input: TokensEstimateInput): Promise<TokensEstimateResult>;

  };



  // ---- Providers ----

  providers: {

    list(): Promise<ProviderConfig[]>;

    add(input: AddProviderInput): Promise<ProviderConfig>;

    update(

      id: string,

      patch: Partial<AddProviderInput> & {

        enabled?: boolean;

        /** OpenRouter app-attribution overrides; see ProviderConfig.attribution. */

        attribution?: ProviderAttribution;

        /** Per-model thinking-effort overrides (shallow-merged store-side). */

        modelThinking?: Record<string, ThinkingEffort | null>;

        /** Per-model context-window overrides in tokens (shallow-merged). */

        contextOverrides?: Record<string, number | null>;

        /** OpenAI-dialect transport when `dialect` is openai. */

        openaiTransport?: import('./provider.js').OpenAiTransport;

        /** Optional billing/admin API key (encrypted in main). Pass null to clear. */
        billingApiKey?: string | null;

      }

    ): Promise<ProviderConfig>;

    remove(id: string): Promise<void>;

    discoverModels(id: string, force?: boolean): Promise<ModelInfo[]>;

    test(id: string): Promise<{ ok: boolean; message: string }>;

    getAccounts(): Promise<ProviderAccountSnapshotMap>;

    refreshAccounts(): Promise<ProviderAccountSnapshotMap>;

    setAccountPollSource(source: string, active: boolean): Promise<void>;

    onAccountsUpdated(cb: (map: ProviderAccountSnapshotMap) => void): () => void;

    onModelsUpdated(cb: (update: import('./provider.js').ProviderModelsUpdate) => void): () => void;

    onDiscoveryPollHint(
      cb: (hint: import('./provider.js').ProviderDiscoveryPollHint) => void
    ): () => void;

  };



  // ---- Chat / orchestrator ----

  chat: {

    send(input: ChatSendInput): Promise<ChatSendReply>;

    abort(runId: string): Promise<void>;

    onEvent(cb: (runId: string, event: TimelineEvent) => void): () => void;

    onDone(cb: (runId: string) => void): () => void;

    onError(cb: (runId: string, message: string) => void): () => void;

    /**

     * Snapshot of every orchestrator run currently in flight in main.

     * Used by the renderer at boot to rehydrate its `runId →

     * conversation` dispatch table after a renderer reload (HMR /

     * F5). Without this, sibling-workspace runs keep streaming events

     * the renderer no longer recognises and they're silently dropped.

     */

    listActiveRuns(): Promise<ActiveRunInfo[]>;

    /** Resume a run paused at an `ask_user` prompt with structured answers. */

    submitAskUser(input: AskUserSubmitInput): Promise<AskUserSubmitReply>;

    /** Subscribe to run-paused-at-ask_user broadcasts. */

    onAwaitingUser(cb: (runId: string) => void): () => void;

  };



  // ---- Conversations (persistent JSONL transcripts) ----

  conversations: {

    /**

     * List conversations. When `workspaceId` is supplied, only

     * conversations stamped with that id are returned; otherwise the

     * full cross-workspace list is returned (used by the dock tree

     * to render every group in one pass).

     */

    list(workspaceId?: string): Promise<ConversationMeta[]>;

    read(id: string): Promise<Conversation | null>;

    readTail(id: string, limit?: number): Promise<import('./chat.js').ConversationTailRead | null>;

    readBefore(
      id: string,
      beforeEventId: string,
      limit?: number
    ): Promise<import('./chat.js').TranscriptBeforeRead>;

    export(
      id: string,
      format: import('./chat.js').ConversationExportFormat
    ): Promise<import('./chat.js').ConversationExportResult>;

    /**

     * Create a new conversation under a specific workspace. The

     * renderer always passes the active workspace id; main rejects

     * with a thrown error when no workspaces are registered yet.

     */

    create(workspaceId: string): Promise<ConversationMeta>;

    rename(id: string, title: string): Promise<ConversationMeta>;

    remove(id: string): Promise<void>;

    /**

     * Move a conversation under a different workspace. Aborts any

     * in-flight runs pinned to it (workspaceId is part of every run's

     * pinned sandbox; re-pinning mid-run would silently swap the

     * orchestrator's effective workspace path). Throws on unknown id

     * / unknown target. Returns the refreshed meta.

     */

    move(id: string, targetWorkspaceId: string): Promise<ConversationMeta>;

    archive(id: string): Promise<ConversationMeta>;

    unarchive(id: string): Promise<ConversationMeta>;

    /**
     * Increment Vyotiq-estimated spend for a completed turn. Idempotent
     * per `(conversationId, promptId)`; returns refreshed meta.
     */
    incrementSpend(
      id: string,
      promptId: string,
      usd: number,
      stats?: TurnUsageStatsDelta
    ): Promise<ConversationMeta | null>;

  };



  // ---- Tools (renderer-initiated helpers) ----

  tools: {

    /**

     * Open a workspace-relative path in the OS default opener.

     *

     * `workspaceId` is optional; when supplied the path is resolved

     * against THAT workspace's root rather than the globally-active

     * workspace. The renderer threads it through whenever it knows

     * which workspace the file belongs to (report "open in browser"

     * clicks for sibling-workspace conversations, etc.) so an open

     * never silently lands on a different workspace's same-relative-path

     * file when the active

     * workspace has drifted away from the artifact's owner.

     *

     * Backwards-compatible: callers that omit it fall back to the

     * legacy active-workspace behavior.

     */

    openPath(path: string, workspaceId?: string): Promise<void>;

    /** Auto-generate an HTML run summary from edit events (no LLM round-trip). */
    generateRunSummary(input: GenerateRunSummaryInput): Promise<GenerateRunSummaryReply>;

  };

  scheduledRuns: {
    list(): Promise<ScheduledRun[]>;
    upsert(input: ScheduledRunInput): Promise<ScheduledRun>;
    delete(id: string): Promise<{ ok: boolean }>;
  };

  // ---- Reports (in-app browser) ----

  reports: {

    /** Open a workspace HTML report in the dedicated report BrowserWindow. */
    open(input: ReportsOpenInput): Promise<ReportsOpenReply>;

  };

  // ---- Context window management (manual controls) ----

  context: {

    /** Force a reversible reduction pass on a conversation now. */
    compactNow(input: ContextManualInput): Promise<ContextManualReply>;

    /** Summarize the conversation so far and continue from a lean context. */
    reset(input: ContextManualInput): Promise<ContextManualReply>;

    /** Read the full content of an offloaded reduction artifact. */
    readArtifact(input: ContextArtifactReadInput): Promise<ContextArtifactReadReply>;

    /** Evaluate prospective prompt usage + per-layer breakdown for the composer meter. */
    evaluate(input: ContextEvaluateInput): Promise<ContextEvaluateReply>;

  };



  // ---- Memory ----

  memory: {

    list(

      scope: 'global' | 'workspace',

      opts?: { keysOnly?: boolean }

    ): Promise<MemoryEntry[]>;

    read(scope: 'global' | 'workspace', key: string): Promise<MemoryEntry | null>;

    /**

     * Write or append to a memory entry.

     *

     * `mode` defaults to `'set'` (overwrite). Pass `'append'` to add a

     * line to an existing entry without rewriting the whole body.

     * `'append'` is only supported for `scope: 'global'`. Workspace

     * scope rejects append with an error (full-textarea editor only).

     *

     * F-022: prior wire shape used the magic key `'append'` to

     * disambiguate the mode, which conflicted with the `key`

     * parameter's role (an entry filename). The dedicated `mode` arg

     * removes the conflict — passing `key: 'append'` no longer has

     * sentinel meaning.

     */

    write(

      scope: 'global' | 'workspace',

      key: string,

      content: string,

      mode?: 'set' | 'append',

      /** When set, records last-referenced metadata for workspace notes. */

      conversationId?: string

    ): Promise<MemoryEntry>;

    /** Open the OS file manager focused on the entry's underlying file. */

    reveal(scope: 'global' | 'workspace', key: string): Promise<void>;

    /** Wipe and rebuild the workspace vector index (active workspace when omitted). */
    reindex(input?: { workspaceId?: string }): Promise<{ ok: true; workspacePath: string }>;

    onReindexProgress(
      cb: (event: import('./memory.js').VectorReindexProgressEvent) => void
    ): () => void;

  };



  // ---- Settings ----

  settings: {

    get(): Promise<AppSettings>;

    set(patch: Partial<AppSettings>): Promise<AppSettings>;

  };



  /** Prompt-cache runtime diagnostics (main-process). */

  promptCache: {

    getStatus(): Promise<import('./promptCache.js').PromptCacheRuntimeStatus>;

  };



  // ---- Checkpoints (transcript rewind) ----

  checkpoints: {

    /**

     * Compute the impact of rewinding a conversation to before a

     * specific user-prompt event WITHOUT performing the rewind. Drives

     * the inline confirmation modal's preview body.

     */

    previewRewind(input: {

      conversationId: string;

      workspaceId: string;

      promptEventId: string;

    }): Promise<RewindPreviewResult>;

    /**

     * Atomically revert every file change AND trim the conversation

     * transcript from the named user-prompt event onward. The

     * inline-on-prompt Revert button calls this after the user

     * confirms the modal preview.

     */

    rewindToPrompt(input: {

      conversationId: string;

      workspaceId: string;

      promptEventId: string;

    }): Promise<RewindResult>;

    /**

     * Subscribe to per-conversation transcript-rewind broadcasts.

     * Fired by `rewindToPrompt` after the JSONL trim lands so the

     * renderer can refresh its cached event slice for the affected

     * conversation. Returns the unsubscribe handle.

     */

    onTranscriptRewound(cb: (conversationId: string) => void): () => void;

    listPending(conversationId: string): Promise<PendingChange[]>;

    accept(entryId: string): Promise<void>;

    acceptAll(conversationId: string): Promise<void>;

    reject(entryId: string): Promise<CheckpointRevertResult>;

    readBlob(workspaceId: string, hash: string): Promise<string | null>;

    onChanged(cb: (workspaceId: string) => void): () => void;

  };



  // ---- Harness overrides (Settings → Agent behavior) ----

  harness: {

    listSections(): Promise<import('./harness.js').HarnessSectionInfo[]>;

    readSection(sectionId: string): Promise<import('./harness.js').HarnessSectionReadResult>;

    writeSection(sectionId: string, body: string): Promise<{ ok: true }>;

    resetSection(sectionId: string): Promise<{ ok: true }>;

  };



  // ---- In-app workspace editor ----

  editor: {

    read(input: import('./editor.js').EditorReadInput): Promise<import('./editor.js').EditorReadResult>;

    write(input: import('./editor.js').EditorWriteInput): Promise<import('./editor.js').EditorWriteReply>;

  };



  // ---- Workspace PTY terminal (multi-session per workspace) ----

  terminal: {

    /** Ensure the workspace primary session exists; returns all live sessions. */
    attach(input: import('./terminal.js').TerminalAttachInput): Promise<import('./terminal.js').TerminalAttachResult>;

    /** Spawn an additional (non-primary) session for a workspace. */
    create(input: import('./terminal.js').TerminalCreateInput): Promise<import('./terminal.js').TerminalCreateResult>;

    /** Kill a single session by id. */
    close(input: import('./terminal.js').TerminalCloseInput): Promise<void>;

    input(payload: import('./terminal.js').TerminalInputPayload): Promise<void>;

    resize(payload: import('./terminal.js').TerminalResizePayload): Promise<void>;

    /** Restart a session in place (kills + respawns its PTY). */
    restart(input: import('./terminal.js').TerminalRestartInput): Promise<import('./terminal.js').TerminalCreateResult>;

    detach(workspaceId?: string): Promise<void>;

    onData(cb: (event: import('./terminal.js').TerminalDataEvent) => void): () => void;

    onExit(cb: (event: import('./terminal.js').TerminalExitEvent) => void): () => void;

  };

  // ---- In-app web browser (Globe) ----

  browser: {

    /** Create/show the embedded browser view; returns current nav state. */
    attach(input?: import('./browser.js').BrowserAttachInput): Promise<import('./browser.js').BrowserAttachResult>;

    navigate(input: import('./browser.js').BrowserNavigateInput): Promise<void>;

    back(): Promise<void>;

    forward(): Promise<void>;

    reload(): Promise<void>;

    stop(): Promise<void>;

    /** Reposition the view over the renderer placeholder rect. */
    setBounds(input: import('./browser.js').BrowserSetBoundsInput): Promise<void>;

    /** Show/hide the view (hidden when the tab is inactive or occluded). */
    setVisible(input: import('./browser.js').BrowserSetVisibleInput): Promise<void>;

    find(input: import('./browser.js').BrowserFindInput): Promise<void>;

    stopFind(): Promise<void>;

    /** Open the current URL in the system default browser. */
    openExternal(input: import('./browser.js').BrowserOpenExternalInput): Promise<void>;

    onState(cb: (event: import('./browser.js').BrowserStateEvent) => void): () => void;

  };



  // ---- Inline completion (editor + composer) ----

  completion: {

    request(input: import('./completion.js').CompletionInput): Promise<import('./completion.js').CompletionReply>;

    cancel(kind: import('./completion.js').CompletionKind, workspaceId?: string): Promise<void>;

  };



  lsp: {

    connect(input: {
      workspaceId: string;
      languageId?: string | null;
    }): Promise<import('./lsp.js').LspConnectResult>;

    send(input: { workspaceId: string; message: string }): Promise<{ ok: true }>;

    status(input: {
      workspaceId: string;
      languageId?: string | null;
    }): Promise<import('./lsp.js').LspConnectResult>;

    disconnect(input: { workspaceId: string }): Promise<{ ok: true }>;

    onMessage(cb: (event: import('./lsp.js').LspMessageEvent) => void): () => void;

  };



  mentions: {

    searchSymbols(input: {
      workspaceId: string;
      query: string;
    }): Promise<{ hits: Array<{ name: string; filePath: string; line: number }> }>;

  };



  // ---- App identity + on-disk paths (Settings → About) ----

  app: {

    /** Host OS platform (`process.platform` from main). */

    platform: 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd';

    /** Read the app's version + userData/settings/log paths. Cheap & idempotent. */

    info(): Promise<AppInfo>;

    /**

     * Reveal one of the whitelisted paths in the OS file manager. The

     * handler maps the enum to a concrete path; the renderer never

     * passes raw paths in.

     */

    revealPath(target: AppRevealTarget): Promise<void>;

    /** Sync Electron `nativeTheme.themeSource` with renderer theme mode. */

    setThemeSource(mode: 'dark' | 'light' | 'system'): Promise<void>;

    /** Check for app updates (electron-updater when packaged). */

    checkForUpdates(): Promise<import('./appUpdate.js').AppCheckUpdatesResult>;

    /** Quit and install a downloaded update. */

    installUpdate(): Promise<void>;

    /** Subscribe to updater phase/progress pushes from main. */

    onUpdateStatus(cb: (status: import('./appUpdate.js').AppUpdateStatus) => void): () => void;

    /** Play the OS warning / exclamation sound (destructive confirm UX). */

    playWarningSound(): Promise<void>;

  };



  attachments: {

    pick(input: {

      workspaceId: string;

      conversationId: string;

      messageId: string;

      maxCount?: number;

    }): Promise<import('./chat.js').PromptAttachmentMeta[]>;

    collectFolder(input: {

      workspaceId: string;

      folderPath: string;

      maxCount?: number;

    }): Promise<{ paths: string[]; total: number; truncated: boolean }>;

    ingestPaths(input: {

      paths: string[];

      workspaceId: string;

      conversationId: string;

      messageId: string;

    }): Promise<import('./chat.js').PromptAttachmentMeta[]>;

    readText(

      input: string | { path: string; workspaceId?: string }

    ): Promise<string>;

    fileUrl(

      input: string | { path: string; workspaceId?: string }

    ): Promise<string>;

    open(input: string | { path: string; workspaceId?: string }): Promise<void>;

  };



  // ---- Renderer → main log relay (used by the React error boundary) ----

  log: (

    level: 'debug' | 'info' | 'warn' | 'error',

    message: string,

    fields?: Record<string, unknown>

  ) => Promise<void>;

}



declare global {

  interface Window {

    vyotiq: VyotiqApi;

  }

}


