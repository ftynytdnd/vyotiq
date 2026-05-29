/**
 * Typed IPC contract. The shape of `window.vyotiq` exposed via contextBridge.
 * Both the preload and the renderer import this; the renderer treats it as
 * read-only.
 */

import type {
  ProviderConfig,
  AddProviderInput,
  ProviderAttribution,
  ModelInfo
} from './provider.js';
import type {
  ChatSendInput,
  ChatSendReply,
  ChatPermissions,
  Conversation,
  ConversationMeta,
  TimelineEvent
} from './chat.js';
import type { RegisteredToolName } from './tool.js';
import type {
  CheckpointRunManifest,
  CheckpointRevertResult,
  CheckpointsSummary,
  FileHistoryRow,
  PendingChange,
  GitBaseDiffResult,
  ListGitRefsResult,
  RewindPreviewResult,
  RewindResult
} from './checkpoint.js';
import type { DiffHunk } from './tool.js';
import type {
  ContextInspectorSnapshot,
  ContextMessageOverride,
  ContextSummaryRules
} from './contextSummary.js';

/**
 * Structured payload for the richer "approve this edit/delete" dialog
 * mounted under `strictApprovalsByWorkspace = true`. The user sees a
 * full diff instead of a text-only "Allow?" modal, so they can make
 * a genuinely informed choice before the write lands.
 *
 * Carried as a sibling of `message` on `ConfirmRequest`. Legacy
 * text-only prompts (destructive-command confirmations, provider
 * writes, etc.) continue to use just `message` and ignore this slot.
 */
export interface EditApprovalPayload {
  kind: 'edit-approval';
  /** Workspace-relative path. */
  filePath: string;
  /** What the tool is about to do. */
  operation: 'create' | 'modify' | 'delete';
  /** Body BEFORE the change. Omitted for `create`. */
  preBody?: string;
  /** Body AFTER the change. Omitted for `delete`. */
  postBody?: string;
  /** Precomputed hunks for `modify` (avoids a renderer-side diff). */
  hunks?: DiffHunk[];
  /** Cosmetic diff stats for the dialog header badge. */
  additions: number;
  deletions: number;
  /** Run id — lets the dialog latch "Accept all remaining in this run". */
  runId: string;
  /** Sub-agent attribution when the change came from a delegate. */
  subagentId?: string;
}

export interface ConfirmRequest {
  id: string;
  /**
   * Plain-text message for legacy text-only confirms (destructive
   * commands, provider permission prompts). When `payload` is set to
   * an `edit-approval` payload the renderer uses the richer
   * `EditApprovalDialog` and ignores `message`.
   */
  message: string;
  /**
   * Structured payload. Currently only `edit-approval` but left open
   * for future richer prompt shapes without churning the wire type.
   */
  payload?: EditApprovalPayload;
}

/**
 * Extended renderer reply shape. Legacy boolean replies still work
 * (the renderer calls `respondConfirm(id, true | false)`); the richer
 * reply adds an `'accept-all'` sentinel the `EditApprovalDialog` uses
 * to latch auto-accept on every subsequent edit in the same run.
 *
 * The main-side confirm bus normalizes booleans into
 * `{ approved: bool }` for back-compat, and the edit-approval handler
 * interprets `'accept-all'` as "approved this one AND set the latch".
 */
export type ConfirmResponse = boolean | { approved: boolean; acceptAllRemaining?: boolean };

export interface ToolRerunInput {
  conversationId: string;
  toolName: RegisteredToolName;
  args: Record<string, unknown>;
  permissions: ChatPermissions;
}

export type ToolRerunReply =
  | { ok: true; callId: string }
  | {
    ok: false;
    reason: 'tool-not-rerunnable' | 'unknown-conversation' | 'execution-failed';
    message?: string;
  };

export interface AppSettings {
  defaultModel?: { providerId: string; modelId: string };
  /**
   * Global context-summarization defaults. Optional on the wire; an
   * absent field is layered onto `DEFAULT_CONTEXT_SUMMARY_RULES` via
   * `resolveContextSummaryRules` so a brand-new install starts with
   * sensible defaults. Workspace overrides live under
   * `ui.contextSummaryByWorkspace[wsId]` and win over this layer.
   */
  contextSummary?: Partial<ContextSummaryRules>;
  /**
   * Optional on the wire (old settings files predate this field), but the
   * settings store ALWAYS populates a fully-resolved `permissions` object
   * on the public `AppSettings` shape (`settingsStore.publicShape`), so
   * consumers can treat this as required after the first `refresh()`.
   *
   * Legacy shape: pre-2026 settings carried three booleans
   * (`allowFileWrites`, `allowBash`, `allowWebSearch`). The main-side
   * `publicShape` derives the new `allowAuto` flag from those on read
   * (truthy iff both `allowFileWrites` and `allowBash` were on); the
   * next `setSettings` write drops the legacy fields. The type stays
   * narrow so consumers never see the deprecated keys.
   */
  permissions?: {
    allowAuto: boolean;
  };
  webSearchEndpoint?: string;
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
    /**
     * Per-workspace permission overrides, keyed by `WorkspaceEntry.id`.
     * When a workspace has an entry here, sending a message under that
     * workspace uses the override INSTEAD of the global `permissions`
     * block. Each entry is a partial — only the flags the user
     * explicitly toggled per-workspace are persisted, and any
     * unspecified flag falls back to the global default. This is the
     * "Trust this workspace" surface the composer's permission menu
     * writes into.
     *
     * Why per-workspace and not per-conversation: the user's mental
     * model is "this folder is safe / unsafe / sandboxed" — a property
     * of the workspace itself, not of any single chat inside it.
     * Per-conversation overrides would multiply the surface area
     * without addressing the actual safety question.
     *
     * Legacy shape: pre-2026 entries carried a partial of the three-
     * flag shape (`allowFileWrites` / `allowBash` / `allowWebSearch`).
     * `publicShape` on the main side derives the new `allowAuto` per
     * entry on read; the next write drops the deprecated keys.
     */
    permissionsByWorkspace?: Record<
      string,
      Partial<{
        allowAuto: boolean;
      }>
    >;
    /**
     * Per-workspace "strict approvals" toggle. When `true`, every
     * `edit` / `delete` tool call pauses the run and surfaces a
     * full-diff approval dialog (`PreApplyApprovalDialog`) instead
     * of writing optimistically. Absence = `false` (post-hoc review
     * mode — Cursor-style). Keyed by `WorkspaceEntry.id`.
     */
    strictApprovalsByWorkspace?: Record<string, boolean>;
    /**
     * Per-workspace "require pending changes to be resolved before
     * sending a new message" toggle. When `true`, `chat:send` on a
     * conversation with pending checkpoint entries resolves with
     * `{ ok: false, kind: 'pending-checkpoints', count }` instead of
     * auto-accepting on the new prompt. Absence = `false` (legacy
     * auto-accept-on-next-prompt behavior, the default). Keyed by
     * `WorkspaceEntry.id`.
     */
    gatePromptOnPendingByWorkspace?: Record<string, boolean>;
    /**
     * When `true`, clicking Approve in PR-style review auto-accepts
     * pending checkpoint rows for that file. Default off (metadata only).
     */
    approveAutoAcceptPendingByWorkspace?: Record<string, boolean>;
    /**
     * When `true`, `chat:send` is blocked while PR review metadata has
     * `request_changes` for the conversation.
     */
    gatePromptOnReviewRequestChangesByWorkspace?: Record<string, boolean>;
    /**
     * Per-workspace context-summarization rule overrides. Each entry is
     * a partial `ContextSummaryRules` that wins over the global
     * `contextSummary` slot for runs pinned to that workspace. Layered
     * via `resolveContextSummaryRules`. Keyed by `WorkspaceEntry.id`.
     *
     * Why per-workspace (and not per-conversation) for the rules: rules
     * are *policy* (when to trigger, what to preserve, which model to
     * use); per-message overrides are *content* and live in the
     * conversation's JSONL transcript via `context-override-set` events.
     * Two-layer split matches the existing permissions / strict-
     * approvals pattern.
     */
    contextSummaryByWorkspace?: Record<string, Partial<ContextSummaryRules>>;
    /**
     * Absolute token count at which the timeline shows a budget-warning
     * row when orchestrator usage crosses this threshold. Displayed in
     * Settings → Context as thousands (`k`). Absence falls back to
     * `TOKEN_BUDGET_WARNING_DEFAULT_TOKENS` (128k).
     */
    tokenBudgetWarningTokens?: number;
    /**
     * Per-workspace override for `tokenBudgetWarningTokens`. Wins over
     * the global slot for runs in that workspace.
     */
    tokenBudgetWarningByWorkspace?: Record<string, number>;
    /** Appearance: dark, light, or follow OS. */
    theme?: 'dark' | 'light' | 'system';
    density?: 'compact' | 'balanced' | 'airy';
    reducedMotion?: boolean;
    /** Starred models in the composer picker (`providerId:modelId`). */
    favoriteModels?: string[];
    /** Last floating panel widths by panel id. */
    panelWidths?: Record<string, number>;
    /** When true, Settings opens on Appearance on next launch only. */
    firstLaunch?: boolean;
    /** Last Settings subnav tab. */
    lastSettingsTab?: string;
    /** Last Checkpoints subnav tab (`runs`, `files`, or `review`). */
    lastCheckpointsTab?: string;
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
    get(): Promise<WorkspaceInfo>;
    /** `null` when the user dismisses the folder picker. */
    pick(): Promise<WorkspaceInfo | null>;
    /**
     * Open the OS folder picker and return the chosen path without
     * adding or activating a workspace (used by the path prompt).
     */
    pickDirectory(): Promise<string | null>;
    set(path: string): Promise<WorkspaceInfo>;
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
      }
    ): Promise<ProviderConfig>;
    remove(id: string): Promise<void>;
    discoverModels(id: string, force?: boolean): Promise<ModelInfo[]>;
    test(id: string): Promise<{ ok: boolean; message: string }>;
    /**
     * Pin a custom context-window value for a given model on this provider,
     * or pass `value: null` to clear the override. Returns the updated
     * provider record. Used when /v1/models doesn't expose `context_length`
     * (OpenAI / Anthropic / DeepSeek direct) or when the user wants to
     * pin a ceiling regardless of what the router reports.
     */
    setContextOverride(
      providerId: string,
      modelId: string,
      value: number | null
    ): Promise<ProviderConfig>;
  };

  // ---- Token estimation (pre-flight, BPE-based) ----
  tokens: {
    /**
     * Best-effort token count for a composer draft. Resolves the right
     * encoding for the given model id (o200k_base for GPT-4o+ / DeepSeek,
     * cl100k_base fallback, chars/3.8 for models with no BPE).
     *
     * When `conversationId` is supplied (Phase 2 — 2026), the main
     * process ALSO tokenizes the full prospective `messages[]` that
     * the next request would carry (system prompt + harness +
     * envelopes + replayed history + tool schemas) and returns the
     * per-part breakdown alongside the draft count. `tokens` then
     * carries the sum (`baseline.total + draftTokens`); legacy
     * callers that omit `conversationId` get just the draft count
     * in `tokens` with no `baseline` slot. Field-additive on the
     * wire so existing callers are unaffected.
     */
    estimate(input: {
      modelId: string;
      prompt: string;
      attachments?: string[];
      attachmentMeta?: import('./chat.js').PromptAttachmentMeta[];
      conversationId?: string;
    }): Promise<{
      tokens: number;
      exact: boolean;
      /** Present iff `conversationId` was supplied. */
      draftTokens?: number;
      /** Present iff `conversationId` was supplied. Sums to
       *  `baseline.systemPrompt + baseline.history + baseline.tools`. */
      baseline?: {
        total: number;
        systemPrompt: number;
        history: number;
        tools: number;
      };
    }>;
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
    onConfirmRequest(cb: (req: ConfirmRequest) => void): () => void;
    /**
     * Subscribe to confirm-cancel broadcasts. Fired when the main process
     * resolves a pending confirm request WITHOUT a renderer reply (server-
     * side timeout, shutdown drain). The renderer must drop the matching
     * pending dialog so it never lingers visible after main has already
     * fail-closed the request.
     */
    onConfirmCancel(cb: (id: string) => void): () => void;
    /**
     * Reply to a `TOOLS_REQUEST_CONFIRM`. Bare `true` / `false` matches
     * the legacy text-only dialog. The richer `EditApprovalDialog`
     * passes `{ approved, acceptAllRemaining }` so a single click can
     * Both approve THIS edit AND latch auto-accept for the rest of
     * the run.
     */
    respondConfirm(id: string, reply: ConfirmResponse): Promise<void>;
    /** Re-run a settled read/ls/search/bash tool against the workspace. */
    rerun(input: ToolRerunInput): Promise<ToolRerunReply>;
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

  // ---- Checkpoints (file-change review + revert) ----
  checkpoints: {
    /** Summary (runs, files, disk usage) for one workspace. */
    summary(workspaceId: string): Promise<CheckpointsSummary>;
    /** Full run manifest with every entry. */
    readRun(workspaceId: string, runId: string): Promise<CheckpointRunManifest | null>;
    /** Chronological history rows for one workspace-relative file. */
    readFileHistory(workspaceId: string, filePath: string): Promise<FileHistoryRow[]>;
    /** Pending changes for one conversation. */
    listPending(conversationId: string): Promise<PendingChange[]>;
    /** Drop one entry from pending without reverting. */
    accept(entryId: string): Promise<void>;
    /** Drop every pending entry for a conversation. */
    acceptAll(conversationId: string): Promise<void>;
    /** Revert AND drop from pending. */
    reject(entryId: string): Promise<CheckpointRevertResult>;
    /**
     * Revert one entry by id (does not touch pending).
     * Main resolves the entry's owning workspace/run via manifest scan.
     */
    revertEntry(entryId: string): Promise<CheckpointRevertResult>;
    /** Revert an entire run (reverse order). */
    revertRun(runId: string): Promise<CheckpointRevertResult>;
    /** Revert one file to a content hash from its history. */
    revertFileToHash(
      workspaceId: string,
      filePath: string,
      hash: string
    ): Promise<CheckpointRevertResult>;
    /** Read a snapshot blob's UTF-8 body (used for diff previews). */
    readBlob(workspaceId: string, hash: string): Promise<string | null>;
    /**
     * Read the CURRENT on-disk contents of a workspace-relative file
     * (UTF-8). Used by `FileHistoryList` to render a "compare with
     * current" diff against any snapshot. Returns `null` when the
     * file no longer exists on disk.
     */
    readCurrentFile(workspaceId: string, filePath: string): Promise<string | null>;
    /** Write an archive of the workspace's checkpoint store into the workspace. */
    exportArchive(workspaceId: string): Promise<{ archivePath: string; bytes: number }>;
    /** Prune older than N days. `days: 0` clears everything for the workspace. */
    prune(workspaceId: string, days: number): Promise<{ removedRuns: number; removedBlobs: number }>;
    /**
     * Delete a single run + every blob it uniquely references + any
     * pending rows that point at this run's entries. Returns
     * `{ removed: true, droppedPending }` on success and
     * `{ removed: false, droppedPending: 0 }` for an unknown / already-
     * deleted run (idempotent). The Checkpoints view uses this for
     * the per-row Delete affordance.
     */
    deleteRun(workspaceId: string, runId: string): Promise<{ removed: boolean; droppedPending: number }>;
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
    /** Unified diff vs git ref for one workspace-relative path. */
    gitBaseDiff(
      workspaceId: string,
      filePath: string,
      ref?: string
    ): Promise<GitBaseDiffResult>;
    listGitRefs(workspaceId: string): Promise<ListGitRefsResult>;
    /**
     * Subscribe to checkpoint-store mutations. Fired on every accept /
     * reject / revert / prune / export so renderer views can refresh
     * without polling. Returns the unsubscribe handle.
     */
    onChanged(cb: (workspaceId: string) => void): () => void;
    /**
     * Subscribe to per-conversation transcript-rewind broadcasts.
     * Fired by `rewindToPrompt` after the JSONL trim lands so the
     * renderer can refresh its cached event slice for the affected
     * conversation. Returns the unsubscribe handle.
     */
    onTranscriptRewound(cb: (conversationId: string) => void): () => void;
  };

  // ---- Context summarization (orchestrator-side compression) ----
  contextSummary: {
    /**
     * Snapshot the orchestrator's current `messages[]` for a run into
     * a `ContextInspectorSnapshot`. Returns `null` for unknown runIds
     * (e.g. an Inspector opened against a conversation with no active
     * run) — the renderer falls back to inspecting the persisted
     * initial-messages state via `conversations.read` in that case.
     */
    inspect(runId: string): Promise<ContextInspectorSnapshot | null>;
    /**
     * Trigger a manual summarization for the given run. Resolves once
     * the `context-summary-pending` event has been emitted; the actual
     * streaming continues async through `chat.onEvent`. Returns
     * `{ ok: false, reason }` when the trigger was rejected (run
     * unknown, rules disabled, mid-summary, or the summarizable range
     * is below `minMessagesToSummarize`).
     */
    /**
     * Trigger a manual summarization. Two modes:
     *
     *   - **Live** — pass a `runId` for an active orchestrator
     *     run; the second argument MUST be omitted. The handle's
     *     `triggerManual` callback streams events through the
     *     run's existing emit sink.
     *   - **Idle** — pass a `conversationId` as the first argument
     *     and a synthetic `idleRunId` (renderer-minted, registered
     *     in the chat store's `runIdToConv` BEFORE calling) as the
     *     second. The IPC routes the work through
     *     `idleSummaryRuntime.triggerIdleSummary`, which streams
     *     `context-summary-*` events through the same `CHAT_EVENT`
     *     channel and persists them to the JSONL so the next
     *     `chat:send`'s `replayCompression` re-applies the splice.
     *
     * Resolves once the `context-summary-pending` event has been
     * emitted; the actual streaming continues asynchronously and
     * arrives through `chat.onEvent`. Returns `{ ok: false, reason }`
     * when the trigger was rejected (run unknown, rules disabled,
     * mid-summary, or the summarizable range is below
     * `minMessagesToSummarize`). The optional `idleRunId` slot on
     * the success path echoes the synthetic id back so the renderer
     * can confirm the route registration.
     */
    triggerManual(
      runIdOrConversationId: string,
      idleRunId?: string
    ): Promise<
      | { ok: true; summaryId: string; idleRunId?: string }
      | { ok: false; reason: string }
    >;
    /**
     * Revert the splice applied by `summaryId`. Returns `{ ok: false }`
     * when the snapshot has already been GC'd (next user-prompt
     * boundary, run-ended, or unknown id).
     */
    undo(
      runIdOrConversationId: string,
      summaryId: string
    ): Promise<{ ok: boolean; event?: import('./chat.js').TimelineEvent }>;
    /**
     * Cancel an in-flight idle-mode summarization. Returns `{ ok: true }`
     * when a summary was aborted; `{ ok: false }` when none was running.
     */
    abortIdle(conversationId: string): Promise<{ ok: boolean }>;
    /** Cancel summarization on an active orchestrator run (not the whole run). */
    abortLive(runId: string): Promise<{ ok: boolean }>;
    /**
     * Set or clear a per-message override on the given conversation.
     * Persisted as a `context-override-set` TimelineEvent in the JSONL
     * so the override survives renderer reloads and app restarts.
     */
    setMessageOverride(
      conversationId: string,
      messageId: string,
      override: ContextMessageOverride | null
    ): Promise<void>;
    /**
     * Clear ALL per-message overrides on the given conversation. Emits
     * a single `context-override-set` event with the sentinel
     * `messageId: '*'` so replay can reconstruct the same state.
     */
    resetMessageOverrides(conversationId: string): Promise<void>;
    /**
     * Read the fully-resolved rules for the given workspace (global ←
     * workspace overrides collapsed). Used by Settings → Context and
     * by the Inspector to surface what's currently in effect.
     */
    getRules(workspaceId: string | null): Promise<ContextSummaryRules>;
    /**
     * Persist a partial rules patch at the given scope. Returns the
     * refreshed `AppSettings` so the renderer settings-store can swap
     * its cache atomically.
     */
    updateRules(
      scope: 'global' | 'workspace',
      patch: Partial<ContextSummaryRules>,
      workspaceId?: string
    ): Promise<AppSettings>;
    /**
     * Subscribe to inspector-snapshot-changed broadcasts. Fired
     * whenever a run's `messages[]` or override map changed in a way
     * the Inspector would care about. Carries the affected runId so
     * the renderer can refetch only when its open Inspector is bound
     * to that run. Returns the unsubscribe handle.
     */
    onSnapshotChanged(cb: (runId: string) => void): () => void;
  };

  // ---- App identity + on-disk paths (Settings → About) ----
  app: {
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
