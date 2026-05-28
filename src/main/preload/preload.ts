/**
 * Preload — exposes a typed `window.vyotiq` API to the renderer via
 * contextBridge. The renderer NEVER receives `ipcRenderer` directly. All
 * outbound calls go through `invoke`; inbound events are listened to via
 * `on(...)` with a no-op cleanup handle.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../../shared/constants.js';
import type { VyotiqApi } from '../../shared/types/ipc.js';
import type { ChatSendInput, TimelineEvent } from '../../shared/types/chat.js';
import type {
  AddProviderInput,
  ProviderConfig,
  ModelInfo
} from '../../shared/types/provider.js';

function on<TArgs extends unknown[]>(channel: string, cb: (...args: TArgs) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: TArgs) => cb(...args);
  ipcRenderer.on(channel, listener as never);
  return () => {
    ipcRenderer.off(channel, listener as never);
  };
}

const api: VyotiqApi = {
  window: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximizeToggle: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE_TOGGLE),
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED),
    onStateChanged: (cb) => on<[{ isMaximized: boolean }]>(IPC.WINDOW_STATE_CHANGED, cb),
    reload: () => ipcRenderer.invoke(IPC.WINDOW_RELOAD),
    toggleDevTools: () => ipcRenderer.invoke(IPC.WINDOW_TOGGLE_DEVTOOLS)
  },

  workspace: {
    get: () => ipcRenderer.invoke(IPC.WORKSPACE_GET),
    pick: () => ipcRenderer.invoke(IPC.WORKSPACE_PICK),
    pickDirectory: () => ipcRenderer.invoke(IPC.WORKSPACE_PICK_DIRECTORY),
    set: (path: string) => ipcRenderer.invoke(IPC.WORKSPACE_SET, path),
    listTree: (opts) => ipcRenderer.invoke(IPC.WORKSPACE_LIST_TREE, opts),
    list: () => ipcRenderer.invoke(IPC.WORKSPACES_LIST),
    add: (path?: string) => ipcRenderer.invoke(IPC.WORKSPACES_ADD, path),
    setActive: (id: string) => ipcRenderer.invoke(IPC.WORKSPACES_SET_ACTIVE, id),
    rename: (id: string, label: string) => ipcRenderer.invoke(IPC.WORKSPACES_RENAME, id, label),
    remove: (id: string, opts: { deleteConversations: boolean }) =>
      ipcRenderer.invoke(IPC.WORKSPACES_REMOVE, id, opts),
    retryReachability: (id: string) =>
      ipcRenderer.invoke(IPC.WORKSPACES_RETRY_REACHABILITY, id)
  },

  providers: {
    list: () => ipcRenderer.invoke(IPC.PROVIDERS_LIST),
    add: (input: AddProviderInput): Promise<ProviderConfig> =>
      ipcRenderer.invoke(IPC.PROVIDERS_ADD, input),
    update: (id, patch) => ipcRenderer.invoke(IPC.PROVIDERS_UPDATE, id, patch),
    remove: (id) => ipcRenderer.invoke(IPC.PROVIDERS_REMOVE, id),
    discoverModels: (id, force): Promise<ModelInfo[]> =>
      ipcRenderer.invoke(IPC.PROVIDERS_DISCOVER_MODELS, id, force),
    test: (id) => ipcRenderer.invoke(IPC.PROVIDERS_TEST, id),
    setContextOverride: (providerId, modelId, value) =>
      ipcRenderer.invoke(IPC.PROVIDERS_SET_CONTEXT_OVERRIDE, providerId, modelId, value)
  },

  tokens: {
    estimate: (input) => ipcRenderer.invoke(IPC.TOKENS_ESTIMATE, input)
  },

  chat: {
    send: (input: ChatSendInput) => ipcRenderer.invoke(IPC.CHAT_SEND, input),
    abort: (runId: string) => ipcRenderer.invoke(IPC.CHAT_ABORT, runId),
    onEvent: (cb) =>
      on<[string, TimelineEvent]>(IPC.CHAT_EVENT, (runId, event) => cb(runId, event)),
    onDone: (cb) => on<[string]>(IPC.CHAT_DONE, (runId) => cb(runId)),
    onError: (cb) => on<[string, string]>(IPC.CHAT_ERROR, (runId, msg) => cb(runId, msg)),
    listActiveRuns: () => ipcRenderer.invoke(IPC.CHAT_LIST_ACTIVE_RUNS)
  },

  conversations: {
    list: (workspaceId?: string) => ipcRenderer.invoke(IPC.CONVERSATIONS_LIST, workspaceId),
    read: (id) => ipcRenderer.invoke(IPC.CONVERSATIONS_READ, id),
    create: (workspaceId: string) => ipcRenderer.invoke(IPC.CONVERSATIONS_CREATE, workspaceId),
    rename: (id, title) => ipcRenderer.invoke(IPC.CONVERSATIONS_RENAME, id, title),
    remove: (id) => ipcRenderer.invoke(IPC.CONVERSATIONS_REMOVE, id),
    move: (id, targetWorkspaceId) =>
      ipcRenderer.invoke(IPC.CONVERSATIONS_MOVE, id, targetWorkspaceId),
    archive: (id) => ipcRenderer.invoke(IPC.CONVERSATIONS_ARCHIVE, id),
    unarchive: (id) => ipcRenderer.invoke(IPC.CONVERSATIONS_UNARCHIVE, id)
  },

  tools: {
    openPath: (path, workspaceId) =>
      ipcRenderer.invoke(IPC.TOOLS_OPEN_PATH, path, workspaceId),
    onConfirmRequest: (cb) =>
      on<[Parameters<typeof cb>[0]]>(IPC.TOOLS_REQUEST_CONFIRM, cb),
    onConfirmCancel: (cb) => on<[string]>(IPC.TOOLS_CANCEL_CONFIRM, (id) => cb(id)),
    respondConfirm: (id, reply) =>
      ipcRenderer.invoke(IPC.TOOLS_CONFIRM_RESPONSE, id, reply),
    rerun: (input) => ipcRenderer.invoke(IPC.TOOLS_RERUN, input)
  },

  memory: {
    list: (scope, opts) => ipcRenderer.invoke(IPC.MEMORY_LIST, scope, opts),
    read: (scope, key) => ipcRenderer.invoke(IPC.MEMORY_READ, scope, key),
    write: (scope, key, content, mode, conversationId) =>
      ipcRenderer.invoke(IPC.MEMORY_WRITE, scope, key, content, mode, conversationId),
    reveal: (scope, key) => ipcRenderer.invoke(IPC.MEMORY_REVEAL, scope, key)
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch)
  },

  checkpoints: {
    summary: (workspaceId: string) => ipcRenderer.invoke(IPC.CHECKPOINTS_SUMMARY, workspaceId),
    readRun: (workspaceId: string, runId: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_READ_RUN, workspaceId, runId),
    readFileHistory: (workspaceId: string, filePath: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_READ_FILE_HISTORY, workspaceId, filePath),
    listPending: (conversationId: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_LIST_PENDING, conversationId),
    accept: (entryId: string) => ipcRenderer.invoke(IPC.CHECKPOINTS_ACCEPT, entryId),
    acceptAll: (conversationId: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_ACCEPT_ALL, conversationId),
    reject: (entryId: string) => ipcRenderer.invoke(IPC.CHECKPOINTS_REJECT, entryId),
    revertEntry: (entryId: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_REVERT_ENTRY, entryId),
    revertRun: (runId: string) => ipcRenderer.invoke(IPC.CHECKPOINTS_REVERT_RUN, runId),
    revertFileToHash: (workspaceId: string, filePath: string, hash: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_REVERT_FILE_TO_HASH, workspaceId, filePath, hash),
    readBlob: (workspaceId: string, hash: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_READ_BLOB, workspaceId, hash),
    readCurrentFile: (workspaceId: string, filePath: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_READ_CURRENT_FILE, workspaceId, filePath),
    exportArchive: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_EXPORT_ARCHIVE, workspaceId),
    prune: (workspaceId: string, days: number) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_PRUNE, workspaceId, days),
    deleteRun: (workspaceId: string, runId: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_DELETE_RUN, workspaceId, runId),
    previewRewind: (input) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_PREVIEW_REWIND, input),
    rewindToPrompt: (input) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_REWIND_TO_PROMPT, input),
    gitBaseDiff: (workspaceId: string, filePath: string, ref?: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_GIT_BASE_DIFF, workspaceId, filePath, ref),
    listGitRefs: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_LIST_GIT_REFS, workspaceId),
    onChanged: (cb) => on<[string]>(IPC.CHECKPOINTS_CHANGED, (workspaceId) => cb(workspaceId)),
    onTranscriptRewound: (cb) =>
      on<[string]>(IPC.CONVERSATION_TRANSCRIPT_REWOUND, (conversationId) => cb(conversationId))
  },

  contextSummary: {
    inspect: (runId: string) =>
      ipcRenderer.invoke(IPC.CONTEXT_SUMMARY_INSPECT, runId),
    triggerManual: (runId: string, idleRunId?: string) =>
      ipcRenderer.invoke(
        IPC.CONTEXT_SUMMARY_TRIGGER_MANUAL,
        runId,
        idleRunId
      ),
    undo: (runId: string, summaryId: string) =>
      ipcRenderer.invoke(IPC.CONTEXT_SUMMARY_UNDO, runId, summaryId),
    abortIdle: (conversationId: string) =>
      ipcRenderer.invoke(IPC.CONTEXT_SUMMARY_ABORT_IDLE, conversationId),
    abortLive: (runId: string) =>
      ipcRenderer.invoke(IPC.CONTEXT_SUMMARY_ABORT_LIVE, runId),
    setMessageOverride: (conversationId, messageId, override) =>
      ipcRenderer.invoke(
        IPC.CONTEXT_SUMMARY_SET_MESSAGE_OVERRIDE,
        conversationId,
        messageId,
        override
      ),
    resetMessageOverrides: (conversationId: string) =>
      ipcRenderer.invoke(
        IPC.CONTEXT_SUMMARY_RESET_MESSAGE_OVERRIDES,
        conversationId
      ),
    getRules: (workspaceId: string | null) =>
      ipcRenderer.invoke(IPC.CONTEXT_SUMMARY_GET_RULES, workspaceId),
    updateRules: (scope, patch, workspaceId) =>
      ipcRenderer.invoke(
        IPC.CONTEXT_SUMMARY_UPDATE_RULES,
        scope,
        patch,
        workspaceId
      ),
    onSnapshotChanged: (cb) =>
      on<[string]>(IPC.CONTEXT_SUMMARY_SNAPSHOT_CHANGED, (runId) => cb(runId))
  },

  app: {
    info: () => ipcRenderer.invoke(IPC.APP_INFO_GET),
    revealPath: (target) => ipcRenderer.invoke(IPC.APP_REVEAL_PATH, target),
    setThemeSource: (mode) => ipcRenderer.invoke(IPC.APP_SET_THEME_SOURCE, mode),
    checkForUpdates: () => ipcRenderer.invoke(IPC.APP_CHECK_UPDATES),
    playWarningSound: () => ipcRenderer.invoke(IPC.APP_PLAY_WARNING_SOUND)
  },

  attachments: {
    pick: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_PICK, input),
    ingestPaths: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_INGEST_PATHS, input),
    readText: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_READ_TEXT, input),
    fileUrl: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_FILE_URL, input),
    open: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_OPEN, input)
  },

  log: (level, message, fields) =>
    ipcRenderer.invoke(IPC.RENDERER_LOG, level, message, fields)
};

contextBridge.exposeInMainWorld('vyotiq', api);
