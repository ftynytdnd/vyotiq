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
    test: (id) => ipcRenderer.invoke(IPC.PROVIDERS_TEST, id)
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
    previewRewind: (input) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_PREVIEW_REWIND, input),
    rewindToPrompt: (input) =>
      ipcRenderer.invoke(IPC.CHECKPOINTS_REWIND_TO_PROMPT, input),
    onTranscriptRewound: (cb) =>
      on<[string]>(IPC.CONVERSATION_TRANSCRIPT_REWOUND, (conversationId) => cb(conversationId))
  },

  app: {
    platform: process.platform,
    info: () => ipcRenderer.invoke(IPC.APP_INFO_GET),
    revealPath: (target) => ipcRenderer.invoke(IPC.APP_REVEAL_PATH, target),
    setThemeSource: (mode) => ipcRenderer.invoke(IPC.APP_SET_THEME_SOURCE, mode),
    checkForUpdates: () => ipcRenderer.invoke(IPC.APP_CHECK_UPDATES),
    playWarningSound: () => ipcRenderer.invoke(IPC.APP_PLAY_WARNING_SOUND)
  },

  attachments: {
    pick: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_PICK, input),
    collectFolder: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_COLLECT_FOLDER, input),
    ingestPaths: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_INGEST_PATHS, input),
    readText: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_READ_TEXT, input),
    fileUrl: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_FILE_URL, input),
    open: (input) => ipcRenderer.invoke(IPC.ATTACHMENTS_OPEN, input)
  },

  log: (level, message, fields) =>
    ipcRenderer.invoke(IPC.RENDERER_LOG, level, message, fields)
};

contextBridge.exposeInMainWorld('vyotiq', api);
