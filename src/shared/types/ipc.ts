/**

 * Typed IPC contract. The shape of `window.vyotiq` exposed via contextBridge.

 * Both the preload and the renderer import this; the renderer treats it as

 * read-only.

 */



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

  ChatPermissions,

  Conversation,

  ConversationMeta,

  TimelineEvent,

  PromptAttachmentMeta

} from './chat.js';

import type { AskUserSubmitInput, AskUserSubmitReply } from './askUser.js';

import type { RegisteredToolName } from './tool.js';

import type {

  RewindPreviewResult,

  RewindResult

} from './checkpoint.js';





export interface ToolRerunInput {

  conversationId: string;

  toolName: RegisteredToolName;

  args: Record<string, unknown>;

  permissions: ChatPermissions;

}

export interface GenerateRunSummaryInput {

  conversationId: string;

  workspaceId: string;

  promptId: string;

  promptPreview: string;

  durationMs: number;

  completedAt: number;

  edits: Array<{ filePath: string; additions: number; deletions: number }>;

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



export type ToolRerunReply =

  | { ok: true; callId: string }

  | {

    ok: false;

    reason: 'tool-not-rerunnable' | 'unknown-conversation' | 'execution-failed';

    message?: string;

  };



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

  permissions?: ChatPermissions;

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

     * Expanded left dock width in px. Default 200; clamped 180–320.

     */

    dockWidth?: number;

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
    workspaceSpendUsd?: Record<string, number>;

    /** Last floating panel widths by panel id. */

    panelWidths?: Record<string, number>;

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

    /** Atomic workspace spend increments (USD) — merged server-side. */

    workspaceSpendIncrement?: Record<string, number>;

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

  /** Resolved `app.getPath('userData')`. */

  userDataDir: string;

  /** Absolute path to `settings.json` inside `userDataDir`. */

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

    /** Re-run a settled read/ls/search/memory tool against the workspace. */

    rerun(input: ToolRerunInput): Promise<ToolRerunReply>;

    /** Auto-generate an HTML run summary from edit events (no LLM round-trip). */
    generateRunSummary(input: GenerateRunSummaryInput): Promise<GenerateRunSummaryReply>;

  };

  // ---- Reports (in-app browser) ----

  reports: {

    /** Open a workspace HTML report in the dedicated report BrowserWindow. */
    open(input: ReportsOpenInput): Promise<ReportsOpenReply>;

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

    checkForUpdates(): Promise<{ updateAvailable: boolean; version?: string }>;

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


