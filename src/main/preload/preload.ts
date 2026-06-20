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
import type { ProviderAccountSnapshotMap } from '../../shared/types/providerAccount.js';
import type { AskUserSubmitInput } from '../../shared/types/askUser.js';

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
    pickDirectory: () => ipcRenderer.invoke(IPC.WORKSPACE_PICK_DIRECTORY),
    listTree: (opts) => ipcRenderer.invoke(IPC.WORKSPACE_LIST_TREE, opts),
    listChildren: (input) => ipcRenderer.invoke(IPC.WORKSPACE_LIST_CHILDREN, input),
    gitStatus: (opts) => ipcRenderer.invoke(IPC.WORKSPACE_GIT_STATUS, opts),
    list: () => ipcRenderer.invoke(IPC.WORKSPACES_LIST),
    add: (path?: string) => ipcRenderer.invoke(IPC.WORKSPACES_ADD, path),
    setActive: (id: string) => ipcRenderer.invoke(IPC.WORKSPACES_SET_ACTIVE, id),
    rename: (id: string, label: string) => ipcRenderer.invoke(IPC.WORKSPACES_RENAME, id, label),
    remove: (id: string, opts: { deleteConversations: boolean }) =>
      ipcRenderer.invoke(IPC.WORKSPACES_REMOVE, id, opts),
    retryReachability: (id: string) =>
      ipcRenderer.invoke(IPC.WORKSPACES_RETRY_REACHABILITY, id),
    mkdir: (input) => ipcRenderer.invoke(IPC.WORKSPACE_MKDIR, input),
    renamePath: (input) => ipcRenderer.invoke(IPC.WORKSPACE_RENAME_PATH, input),
    deletePath: (input) => ipcRenderer.invoke(IPC.WORKSPACE_DELETE_PATH, input),
    revealPath: (input) => ipcRenderer.invoke(IPC.WORKSPACE_REVEAL_PATH, input),
    onTreeChanged: (cb) =>
      on<[import('@shared/types/ipc.js').WorkspaceTreeChangedPayload]>(
        IPC.WORKSPACE_TREE_CHANGED,
        (payload) => cb(payload)
      )
  },

  tokens: {
    estimate: (input) => ipcRenderer.invoke(IPC.TOKENS_ESTIMATE, input)
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
    getAccounts: () => ipcRenderer.invoke(IPC.PROVIDERS_GET_ACCOUNTS),
    refreshAccounts: () => ipcRenderer.invoke(IPC.PROVIDERS_REFRESH_ACCOUNTS),
    setAccountPollSource: (source: string, active: boolean) =>
      ipcRenderer.invoke(IPC.PROVIDERS_SET_ACCOUNT_POLL_SOURCE, source, active),
    onAccountsUpdated: (cb) =>
      on<[ProviderAccountSnapshotMap]>(IPC.PROVIDERS_ACCOUNT_UPDATED, (map) => cb(map)),
    onModelsUpdated: (cb) =>
      on<[import('@shared/types/provider.js').ProviderModelsUpdate]>(
        IPC.PROVIDERS_MODELS_UPDATED,
        (update) => cb(update)
      ),
    onDiscoveryPollHint: (cb) =>
      on<[import('@shared/types/provider.js').ProviderDiscoveryPollHint]>(
        IPC.PROVIDERS_DISCOVERY_POLL_HINT,
        (hint) => cb(hint)
      )
  },

  chat: {
    send: (input: ChatSendInput) => ipcRenderer.invoke(IPC.CHAT_SEND, input),
    abort: (runId: string) => ipcRenderer.invoke(IPC.CHAT_ABORT, runId),
    onEvent: (cb) =>
      on<[string, TimelineEvent]>(IPC.CHAT_EVENT, (runId, event) => cb(runId, event)),
    onDone: (cb) => on<[string]>(IPC.CHAT_DONE, (runId) => cb(runId)),
    onError: (cb) => on<[string, string]>(IPC.CHAT_ERROR, (runId, msg) => cb(runId, msg)),
    listActiveRuns: () => ipcRenderer.invoke(IPC.CHAT_LIST_ACTIVE_RUNS),
    submitAskUser: (input: AskUserSubmitInput) => ipcRenderer.invoke(IPC.CHAT_SUBMIT_ASK_USER, input),
    onAwaitingUser: (cb: (runId: string) => void) => on<[string]>(IPC.CHAT_AWAITING_USER, (runId) => cb(runId))
  },

  conversations: {
    list: (workspaceId?: string) => ipcRenderer.invoke(IPC.CONVERSATIONS_LIST, workspaceId),
    read: (id) => ipcRenderer.invoke(IPC.CONVERSATIONS_READ, id),
    readTail: (id, limit) => ipcRenderer.invoke(IPC.CONVERSATIONS_READ_TAIL, id, limit),
    readBefore: (id, beforeEventId, limit) =>
      ipcRenderer.invoke(IPC.CONVERSATIONS_READ_BEFORE, id, beforeEventId, limit),
    export: (id, format) => ipcRenderer.invoke(IPC.CONVERSATIONS_EXPORT, id, format),
    create: (workspaceId: string) => ipcRenderer.invoke(IPC.CONVERSATIONS_CREATE, workspaceId),
    rename: (id, title) => ipcRenderer.invoke(IPC.CONVERSATIONS_RENAME, id, title),
    remove: (id) => ipcRenderer.invoke(IPC.CONVERSATIONS_REMOVE, id),
    move: (id, targetWorkspaceId) =>
      ipcRenderer.invoke(IPC.CONVERSATIONS_MOVE, id, targetWorkspaceId),
    archive: (id) => ipcRenderer.invoke(IPC.CONVERSATIONS_ARCHIVE, id),
    unarchive: (id) => ipcRenderer.invoke(IPC.CONVERSATIONS_UNARCHIVE, id),
    incrementSpend: (id, promptId, usd, stats) =>
      ipcRenderer.invoke(IPC.CONVERSATIONS_INCREMENT_SPEND, id, promptId, usd, stats)
  },

  scheduledRuns: {
    list: () => ipcRenderer.invoke(IPC.SCHEDULED_RUNS_LIST),
    upsert: (input) => ipcRenderer.invoke(IPC.SCHEDULED_RUNS_UPSERT, input),
    delete: (id) => ipcRenderer.invoke(IPC.SCHEDULED_RUNS_DELETE, id)
  },

  followUps: {
    list: (conversationId: string) => ipcRenderer.invoke(IPC.FOLLOW_UPS_LIST, conversationId),
    enqueue: (input) => ipcRenderer.invoke(IPC.FOLLOW_UPS_ENQUEUE, input),
    update: (input) => ipcRenderer.invoke(IPC.FOLLOW_UPS_UPDATE, input),
    remove: (input) => ipcRenderer.invoke(IPC.FOLLOW_UPS_REMOVE, input),
    sendNow: (input) => ipcRenderer.invoke(IPC.FOLLOW_UPS_SEND_NOW, input),
    onUpdated: (cb) =>
      on<[string, import('@shared/types/followUp.js').ConversationFollowUpState]>(
        IPC.FOLLOW_UPS_UPDATED,
        (conversationId, state) => cb(conversationId, state)
      )
  },

  ui: {
    onToast: (cb) =>
      on<[import('@shared/types/uiToast.js').UiToastPayload]>(IPC.UI_TOAST, (payload) => cb(payload))
  },

  tools: {
    openPath: (path, workspaceId) =>
      ipcRenderer.invoke(IPC.TOOLS_OPEN_PATH, path, workspaceId),
    generateRunSummary: (input) =>
      ipcRenderer.invoke(IPC.REPORTS_GENERATE_RUN_SUMMARY, input)
  },

  reports: {
    open: (input) => ipcRenderer.invoke(IPC.REPORTS_OPEN, input)
  },

  context: {
    compactNow: (input) => ipcRenderer.invoke(IPC.CONTEXT_COMPACT_NOW, input),
    reset: (input) => ipcRenderer.invoke(IPC.CONTEXT_RESET, input),
    readArtifact: (input) => ipcRenderer.invoke(IPC.CONTEXT_READ_ARTIFACT, input),
    evaluate: (input) => ipcRenderer.invoke(IPC.CONTEXT_EVALUATE, input)
  },

  memory: {
    list: (scope, opts) => ipcRenderer.invoke(IPC.MEMORY_LIST, scope, opts),
    read: (scope, key) => ipcRenderer.invoke(IPC.MEMORY_READ, scope, key),
    write: (scope, key, content, mode, conversationId) =>
      ipcRenderer.invoke(IPC.MEMORY_WRITE, scope, key, content, mode, conversationId),
    reveal: (scope, key) => ipcRenderer.invoke(IPC.MEMORY_REVEAL, scope, key),
    reindex: (input) => ipcRenderer.invoke(IPC.MEMORY_REINDEX, input),
    onReindexProgress: (cb) =>
      on<[import('@shared/types/memory.js').VectorReindexProgressEvent]>(
        IPC.MEMORY_REINDEX_PROGRESS,
        (event) => cb(event)
      )
  },

  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch) => ipcRenderer.invoke(IPC.SETTINGS_SET, patch)
  },

  promptCache: {
    getStatus: () => ipcRenderer.invoke(IPC.PROMPT_CACHE_STATUS)
  },

  checkpoints: {
    previewRewind: (input) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_PREVIEW_REWIND, input),
    rewindToPrompt: (input) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_REWIND_TO_PROMPT, input),
    listPending: (conversationId) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_LIST_PENDING, conversationId),
    accept: (entryId) => ipcRenderer.invoke(IPC.CHECKPOINTS_ACCEPT, entryId),
    acceptAll: (conversationId) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_ACCEPT_ALL, conversationId),
    reject: (entryId) => ipcRenderer.invoke(IPC.CHECKPOINTS_REJECT, entryId),
    readBlob: (workspaceId, hash) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_READ_BLOB, workspaceId, hash),
    onTranscriptRewound: (cb) =>
      on<[string]>(IPC.CONVERSATION_TRANSCRIPT_REWOUND, (conversationId) => cb(conversationId)),
    onChanged: (cb) =>
      on<[string]>(IPC.CHECKPOINTS_CHANGED, (workspaceId) => cb(workspaceId))
  },

  harness: {
    listSections: () => ipcRenderer.invoke(IPC.HARNESS_LIST_SECTIONS),
    readSection: (sectionId) => ipcRenderer.invoke(IPC.HARNESS_READ_SECTION, sectionId),
    writeSection: (sectionId, body) =>
      ipcRenderer.invoke(IPC.HARNESS_WRITE_SECTION, sectionId, body),
    resetSection: (sectionId) => ipcRenderer.invoke(IPC.HARNESS_RESET_SECTION, sectionId)
  },

  editor: {
    read: (input) => ipcRenderer.invoke(IPC.EDITOR_READ, input),
    write: (input) => ipcRenderer.invoke(IPC.EDITOR_WRITE, input)
  },

  terminal: {
    attach: (input) => ipcRenderer.invoke(IPC.TERMINAL_ATTACH, input),
    create: (input) => ipcRenderer.invoke(IPC.TERMINAL_CREATE, input),
    close: (input) => ipcRenderer.invoke(IPC.TERMINAL_CLOSE, input),
    input: (payload) => ipcRenderer.invoke(IPC.TERMINAL_INPUT, payload),
    resize: (payload) => ipcRenderer.invoke(IPC.TERMINAL_RESIZE, payload),
    restart: (input) => ipcRenderer.invoke(IPC.TERMINAL_RESTART, input),
    detach: (workspaceId) => ipcRenderer.invoke(IPC.TERMINAL_DETACH, workspaceId),
    onData: (cb) =>
      on<[import('@shared/types/terminal.js').TerminalDataEvent]>(IPC.TERMINAL_DATA, (event) =>
        cb(event)
      ),
    onExit: (cb) =>
      on<[import('@shared/types/terminal.js').TerminalExitEvent]>(IPC.TERMINAL_EXIT, (event) =>
        cb(event)
      )
  },

  browser: {
    attach: (input) => ipcRenderer.invoke(IPC.BROWSER_ATTACH, input),
    navigate: (input) => ipcRenderer.invoke(IPC.BROWSER_NAVIGATE, input),
    back: () => ipcRenderer.invoke(IPC.BROWSER_BACK),
    forward: () => ipcRenderer.invoke(IPC.BROWSER_FORWARD),
    reload: () => ipcRenderer.invoke(IPC.BROWSER_RELOAD),
    stop: () => ipcRenderer.invoke(IPC.BROWSER_STOP),
    setBounds: (input) => ipcRenderer.invoke(IPC.BROWSER_SET_BOUNDS, input),
    setVisible: (input) => ipcRenderer.invoke(IPC.BROWSER_SET_VISIBLE, input),
    find: (input) => ipcRenderer.invoke(IPC.BROWSER_FIND, input),
    stopFind: () => ipcRenderer.invoke(IPC.BROWSER_STOP_FIND),
    openExternal: (input) => ipcRenderer.invoke(IPC.BROWSER_OPEN_EXTERNAL, input),
    onState: (cb) =>
      on<[import('@shared/types/browser.js').BrowserStateEvent]>(IPC.BROWSER_STATE, (event) =>
        cb(event)
      )
  },

  capture: {
    listSources: (input) => ipcRenderer.invoke(IPC.CAPTURE_LIST_SOURCES, input),
    screen: (input) => ipcRenderer.invoke(IPC.CAPTURE_SCREEN, input),
    browser: (input) => ipcRenderer.invoke(IPC.CAPTURE_BROWSER, input),
    window: (input) => ipcRenderer.invoke(IPC.CAPTURE_WINDOW, input),
    ingestFrame: (input) => ipcRenderer.invoke(IPC.CAPTURE_INGEST_FRAME, input),
    submitFrameResult: (input) => ipcRenderer.invoke(IPC.CAPTURE_FRAME_RESULT, input),
    onRequestFrame: (cb) =>
      on<[import('../../shared/types/capture.js').CaptureFrameRequestEvent]>(
        IPC.CAPTURE_REQUEST_FRAME,
        (event) => cb(event)
      )
  },

  completion: {
    request: (input) => ipcRenderer.invoke(IPC.COMPLETION_REQUEST, input),
    cancel: (kind, workspaceId) => ipcRenderer.invoke(IPC.COMPLETION_CANCEL, kind, workspaceId)
  },

  lsp: {
    connect: (input) => ipcRenderer.invoke(IPC.LSP_CONNECT, input),
    send: (input) => ipcRenderer.invoke(IPC.LSP_SEND, input),
    status: (input) => ipcRenderer.invoke(IPC.LSP_STATUS, input),
    disconnect: (input) => ipcRenderer.invoke(IPC.LSP_DISCONNECT, input),
    onMessage: (cb) =>
      on<[import('@shared/types/lsp.js').LspMessageEvent]>(IPC.LSP_MESSAGE, (event) => cb(event))
  },

  mentions: {
    searchSymbols: (input) => ipcRenderer.invoke(IPC.MENTIONS_SEARCH_SYMBOLS, input)
  },

  app: {
    platform: process.platform,
    info: () => ipcRenderer.invoke(IPC.APP_INFO_GET),
    revealPath: (target) => ipcRenderer.invoke(IPC.APP_REVEAL_PATH, target),
    setThemeSource: (mode) => ipcRenderer.invoke(IPC.APP_SET_THEME_SOURCE, mode),
    checkForUpdates: () => ipcRenderer.invoke(IPC.APP_CHECK_UPDATES),
    installUpdate: () => ipcRenderer.invoke(IPC.APP_INSTALL_UPDATE),
    onUpdateStatus: (cb) =>
      on<[import('@shared/types/appUpdate.js').AppUpdateStatus]>(IPC.APP_UPDATE_STATUS, (status) =>
        cb(status)
      ),
    playWarningSound: () => ipcRenderer.invoke(IPC.APP_PLAY_WARNING_SOUND)
  },

  attachments: {
    pick: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_PICK, input),
    collectFolder: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_COLLECT_FOLDER, input),
    ingestPaths: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_INGEST_PATHS, input),
    ingestClipboardImage: (input) =>
      ipcRenderer.invoke(IPC.ATTACHMENTS_INGEST_CLIPBOARD_IMAGE, input),
    ingestClipboard: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_INGEST_CLIPBOARD, input),
    readText: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_READ_TEXT, input),
    fileUrl: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_FILE_URL, input),
    open: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_OPEN, input)
  },

  log: (level, message, fields) =>
    ipcRenderer.invoke(IPC.RENDERER_LOG, level, message, fields)
};

contextBridge.exposeInMainWorld('vyotiq', api);
