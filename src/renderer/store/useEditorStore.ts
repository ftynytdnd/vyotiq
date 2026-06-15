/**
 * Zustand store for the in-app workspace editor (workbench) with multi-tab support.
 */

import { create } from 'zustand';
import type { EditorEncoding, EditorEol } from '@shared/types/editor.js';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { normalizePath } from '../lib/normalizePath.js';
import { vyotiq } from '../lib/ipc.js';
import { closeSettingsForCompanionOpen } from './useAppViewStore.js';
import {
  focusDockFilesPanel,
  focusWorkbenchTab,
  syncWorkbenchTabAfterClose
} from '../components/workbench/workbenchShared.js';
import { pushRecentEditorFile } from '../lib/recentEditorFiles.js';
import { useAttachmentPreviewStore } from './useAttachmentPreviewStore.js';
import { useToastStore } from './useToastStore.js';
import { useEditorCursorStore } from './useEditorCursorStore.js';
import { revealFileInDockTree } from '../lib/revealFileInDockTree.js';
import { schedulePersistEditorTabs } from '../lib/editorTabsPersistence.js';
import { reorderWorkspaceTabs as reorderWorkspaceTabsInList } from '../lib/editorTabReorder.js';

export const MAX_EDITOR_TABS = 20;

/** Debounced autosave delay after the last edit keystroke. */
export const EDITOR_AUTOSAVE_DEBOUNCE_MS = 1500;

const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelAutoSave(filePath: string): void {
  const id = normalizePath(filePath);
  const timer = autoSaveTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    autoSaveTimers.delete(id);
  }
}

function scheduleAutoSave(filePath: string, runSave: () => Promise<boolean>): void {
  cancelAutoSave(filePath);
  const id = normalizePath(filePath);
  autoSaveTimers.set(
    id,
    setTimeout(() => {
      autoSaveTimers.delete(id);
      void runSave();
    }, EDITOR_AUTOSAVE_DEBOUNCE_MS)
  );
}

export interface EditorOpenOpts {
  workspaceId?: string;
  /** Skip disk read — seed buffer from agent stream / diff preview. */
  initialContent?: string;
  initialMtimeMs?: number;
}

export interface EditorTab {
  filePath: string;
  workspaceId: string | null;
  content: string;
  savedContent: string;
  mtimeMs: number | null;
  truncated: boolean;
  loading: boolean;
  saving: boolean;
  staleOnDisk: boolean;
  error: string | null;
  /** Line-ending style detected on disk. */
  eol: EditorEol;
  /** On-disk text encoding. */
  encoding: EditorEncoding;
  utf8Bom: boolean;
  /** Agent is streaming edits into this buffer — editor read-only until settled. */
  agentStreaming?: boolean;
}

interface EditorStore {
  open: boolean;
  tabs: EditorTab[];
  activeFilePath: string | null;

  /** Active tab file path (compat). */
  filePath: string | null;
  workspaceId: string | null;
  content: string;
  savedContent: string;
  mtimeMs: number | null;
  truncated: boolean;
  loading: boolean;
  saving: boolean;
  staleOnDisk: boolean;
  error: string | null;

  openFile: (filePath: string, opts?: EditorOpenOpts) => Promise<void>;
  /** Open editor surface without a file (empty state). */
  openPanel: () => void;
  close: () => void;
  closeTab: (filePath: string) => void;
  /** Close tab or queue unsaved prompt. Returns false when prompt is shown. */
  requestCloseTab: (filePath: string) => boolean;
  forceCloseTab: (filePath: string) => void;
  remapTabPath: (from: string, to: string) => void;
  pendingUnsavedClose: string | null;
  completeUnsavedClose: (action: 'save' | 'discard') => Promise<void>;
  cancelUnsavedClose: () => void;
  isTabDirty: (filePath: string) => boolean;
  setActiveTab: (filePath: string) => void;
  reorderWorkspaceTabs: (workspaceId: string, fromFilePath: string, toFilePath: string) => void;
  setContent: (content: string) => void;
  reloadFromDisk: () => Promise<void>;
  /** Re-read one tab from disk or mark stale when the buffer has unsaved edits. */
  refreshTabFromDisk: (filePath: string, opts?: { force?: boolean }) => Promise<void>;
  save: () => Promise<boolean>;
  markStaleOnDisk: (filePath?: string) => void;
  applyExternalContent: (filePath: string, content: string, mtimeMs?: number) => void;
  setAgentStreaming: (filePath: string, streaming: boolean) => void;
  /** Scroll active editor to LSP go-to-definition target after tab switch. */
  requestReveal: (filePath: string, line: number, character: number) => void;
  consumeReveal: (filePath: string) => { line: number; character: number } | null;
}

function emptyTabFields(): Pick<
  EditorTab,
  | 'content'
  | 'savedContent'
  | 'mtimeMs'
  | 'truncated'
  | 'loading'
  | 'saving'
  | 'staleOnDisk'
  | 'error'
  | 'eol'
  | 'encoding'
  | 'utf8Bom'
  | 'agentStreaming'
> {
  return {
    content: '',
    savedContent: '',
    mtimeMs: null,
    truncated: false,
    loading: false,
    saving: false,
    staleOnDisk: false,
    error: null,
    eol: 'lf',
    encoding: 'utf-8',
    utf8Bom: false,
    agentStreaming: false
  };
}

function persistTabsForWorkspace(workspaceId: string | null, tabs: EditorTab[], activeFilePath: string | null): void {
  if (!workspaceId) return;
  schedulePersistEditorTabs(
    workspaceId,
    tabs.map((t) => ({
      filePath: t.filePath,
      active: activeFilePath != null && normalizePath(t.filePath) === normalizePath(activeFilePath)
    }))
  );
}

function mirrorActiveTab(state: EditorStore): EditorStore {
  const tab =
    state.activeFilePath != null
      ? state.tabs.find((t) => normalizePath(t.filePath) === normalizePath(state.activeFilePath!))
      : null;
  return {
    ...state,
    filePath: tab?.filePath ?? null,
    workspaceId: tab?.workspaceId ?? null,
    content: tab?.content ?? '',
    savedContent: tab?.savedContent ?? '',
    mtimeMs: tab?.mtimeMs ?? null,
    truncated: tab?.truncated ?? false,
    loading: tab?.loading ?? false,
    saving: tab?.saving ?? false,
    staleOnDisk: tab?.staleOnDisk ?? false,
    error: tab?.error ?? null
  };
}

function updateTab(
  tabs: EditorTab[],
  filePath: string,
  patch: Partial<EditorTab>
): EditorTab[] {
  const id = normalizePath(filePath);
  return tabs.map((t) => (normalizePath(t.filePath) === id ? { ...t, ...patch } : t));
}

const pendingReveal = new Map<string, { line: number; character: number }>();

function performCloseTab(filePath: string, state: EditorStore): EditorStore {
  cancelAutoSave(filePath);
  const id = normalizePath(filePath);
  const closedTab = state.tabs.find((t) => normalizePath(t.filePath) === id);
  const tabs = state.tabs.filter((t) => normalizePath(t.filePath) !== id);
  let activeFilePath = state.activeFilePath;
  if (activeFilePath && normalizePath(activeFilePath) === id) {
    activeFilePath = tabs.length > 0 ? tabs[tabs.length - 1]!.filePath : null;
  }
  const next = mirrorActiveTab({
    ...state,
    tabs,
    activeFilePath,
    open: tabs.length > 0,
    pendingUnsavedClose: null
  });
  if (tabs.length === 0) syncWorkbenchTabAfterClose();
  if (closedTab?.workspaceId) {
    const wsTabs = next.tabs.filter((t) => t.workspaceId === closedTab.workspaceId);
    persistTabsForWorkspace(closedTab.workspaceId, wsTabs, next.activeFilePath);
  }
  return next;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  open: false,
  tabs: [],
  activeFilePath: null,
  filePath: null,
  workspaceId: null,
  content: '',
  savedContent: '',
  mtimeMs: null,
  truncated: false,
  loading: false,
  saving: false,
  staleOnDisk: false,
  error: null,
  pendingUnsavedClose: null,

  isTabDirty: (filePath) => {
    const tab = get().tabs.find((t) => normalizePath(t.filePath) === normalizePath(filePath));
    return tab != null && tab.content !== tab.savedContent;
  },

  openPanel: () => {
    closeSettingsForCompanionOpen();
    useAttachmentPreviewStore.getState().close();
    focusDockFilesPanel();
    focusWorkbenchTab('editor');
    set(mirrorActiveTab({ ...get(), open: true }));
  },

  openFile: async (filePath, opts = {}) => {
    closeSettingsForCompanionOpen();
    useAttachmentPreviewStore.getState().close();
    focusDockFilesPanel();
    focusWorkbenchTab('editor');

    const id = normalizePath(filePath);
    const existing = get().tabs.find((t) => normalizePath(t.filePath) === id);
    if (existing) {
      const next = mirrorActiveTab({ ...get(), open: true, activeFilePath: existing.filePath });
      set(next);
      if (existing.workspaceId) {
        persistTabsForWorkspace(existing.workspaceId, next.tabs, next.activeFilePath);
        pushRecentEditorFile(existing.workspaceId, existing.filePath);
      }
      revealFileInDockTree(existing.filePath);
      return;
    }

    if (get().tabs.length >= MAX_EDITOR_TABS) {
      useToastStore.getState().show(`Maximum ${MAX_EDITOR_TABS} editor tabs open.`, 'danger');
      return;
    }

    if (opts.initialContent !== undefined) {
      const tab: EditorTab = {
        filePath,
        workspaceId: opts.workspaceId ?? null,
        ...emptyTabFields(),
        content: opts.initialContent,
        savedContent: opts.initialContent,
        mtimeMs: opts.initialMtimeMs ?? null
      };
      set(
        mirrorActiveTab({
          ...get(),
          open: true,
          tabs: [...get().tabs, tab],
          activeFilePath: filePath
        })
      );
      if (tab.workspaceId) {
        persistTabsForWorkspace(tab.workspaceId, get().tabs, filePath);
        pushRecentEditorFile(tab.workspaceId, filePath);
      }
      return;
    }

    const loadingTab: EditorTab = {
      filePath,
      workspaceId: opts.workspaceId ?? null,
      ...emptyTabFields(),
      loading: true
    };
    set(
      mirrorActiveTab({
        ...get(),
        open: true,
        tabs: [...get().tabs, loadingTab],
        activeFilePath: filePath
      })
    );

    try {
      const result = await vyotiq.editor.read({
        path: filePath,
        ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {})
      });
      set((state) => {
        const mirrored = mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, filePath, {
            content: result.content,
            savedContent: result.content,
            mtimeMs: result.mtimeMs,
            truncated: result.truncated,
            loading: false,
            eol: result.eol,
            encoding: result.encoding,
            utf8Bom: result.utf8Bom
          })
        });
        if (opts.workspaceId) {
          persistTabsForWorkspace(opts.workspaceId, mirrored.tabs, mirrored.activeFilePath);
        }
        return mirrored;
      });
      if (opts.workspaceId) pushRecentEditorFile(opts.workspaceId, filePath);
      revealFileInDockTree(filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not open ${basenameFromPath(filePath)}: ${msg}`, 'danger');
      set((state) => {
        const tabs = state.tabs.filter((t) => normalizePath(t.filePath) !== id);
        const nextActive = tabs.length > 0 ? tabs[tabs.length - 1]!.filePath : null;
        return mirrorActiveTab({
          ...state,
          tabs,
          activeFilePath: nextActive,
          open: tabs.length > 0
        });
      });
    }
  },

  close: () => {
    set({
      open: false,
      tabs: [],
      activeFilePath: null,
      filePath: null,
      workspaceId: null,
      content: '',
      savedContent: '',
      mtimeMs: null,
      truncated: false,
      loading: false,
      saving: false,
      staleOnDisk: false,
      error: null,
      pendingUnsavedClose: null
    });
    syncWorkbenchTabAfterClose();
  },

  closeTab: (filePath) => {
    get().requestCloseTab(filePath);
  },

  requestCloseTab: (filePath) => {
    if (get().isTabDirty(filePath)) {
      set({ pendingUnsavedClose: filePath });
      return false;
    }
    set((state) => performCloseTab(filePath, state));
    return true;
  },

  forceCloseTab: (filePath) => {
    set((state) => performCloseTab(filePath, state));
  },

  remapTabPath: (from, to) => {
    const fromId = normalizePath(from);
    const toId = normalizePath(to);
    set((state) => {
      const tabs = state.tabs.map((t) =>
        normalizePath(t.filePath) === fromId ? { ...t, filePath: to } : t
      );
      let activeFilePath = state.activeFilePath;
      if (activeFilePath && normalizePath(activeFilePath) === fromId) {
        activeFilePath = to;
      }
      return mirrorActiveTab({ ...state, tabs, activeFilePath });
    });
    const reveal = pendingReveal.get(fromId);
    if (reveal) {
      pendingReveal.delete(fromId);
      pendingReveal.set(toId, reveal);
    }
  },

  completeUnsavedClose: async (action) => {
    const path = get().pendingUnsavedClose;
    if (!path) return;
    if (action === 'save') {
      const prevActive = get().activeFilePath;
      if (normalizePath(get().activeFilePath ?? '') !== normalizePath(path)) {
        get().setActiveTab(path);
      }
      const ok = await get().save();
      if (!ok) return;
      if (prevActive && normalizePath(prevActive) !== normalizePath(path)) {
        get().setActiveTab(prevActive);
      }
    }
    set((state) => performCloseTab(path, state));
  },

  cancelUnsavedClose: () => set({ pendingUnsavedClose: null }),

  setActiveTab: (filePath) => {
    const id = normalizePath(filePath);
    if (!get().tabs.some((t) => normalizePath(t.filePath) === id)) return;
    focusWorkbenchTab('editor');
    const next = mirrorActiveTab({ ...get(), activeFilePath: filePath });
    set(next);
    const tab = next.tabs.find((t) => normalizePath(t.filePath) === id);
    if (tab?.workspaceId) {
      persistTabsForWorkspace(tab.workspaceId, next.tabs, next.activeFilePath);
    }
    useEditorCursorStore.getState().reset();
  },

  reorderWorkspaceTabs: (workspaceId, fromFilePath, toFilePath) => {
    const state = get();
    const tabs = reorderWorkspaceTabsInList(state.tabs, workspaceId, fromFilePath, toFilePath);
    if (tabs.every((tab, index) => tab === state.tabs[index])) return;
    const next = mirrorActiveTab({ ...state, tabs });
    set(next);
    persistTabsForWorkspace(workspaceId, next.tabs, next.activeFilePath);
  },

  setContent: (content) => {
    const { activeFilePath } = get();
    if (!activeFilePath) return;
    set((state) =>
      mirrorActiveTab({
        ...state,
        tabs: updateTab(state.tabs, activeFilePath, { content })
      })
    );
    scheduleAutoSave(activeFilePath, async () => {
      const tab = get().tabs.find(
        (t) => normalizePath(t.filePath) === normalizePath(activeFilePath)
      );
      if (!tab || tab.content === tab.savedContent || tab.saving || tab.staleOnDisk) {
        return false;
      }
      if (
        get().activeFilePath &&
        normalizePath(get().activeFilePath!) !== normalizePath(activeFilePath)
      ) {
        return false;
      }
      return get().save();
    });
  },

  reloadFromDisk: async () => {
    const { activeFilePath } = get();
    if (!activeFilePath) return;
    cancelAutoSave(activeFilePath);
    set((state) =>
      mirrorActiveTab({
        ...state,
        tabs: updateTab(state.tabs, activeFilePath, { loading: true, error: null })
      })
    );
    try {
      await get().refreshTabFromDisk(activeFilePath);
    } finally {
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, activeFilePath, { loading: false })
        })
      );
    }
  },

  refreshTabFromDisk: async (filePath, opts) => {
    const tab = get().tabs.find((t) => normalizePath(t.filePath) === normalizePath(filePath));
    if (!tab) return;
    const force = opts?.force === true;
    if (!force && tab.content !== tab.savedContent) {
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, filePath, { staleOnDisk: true })
        })
      );
      return;
    }
    try {
      const result = await vyotiq.editor.read({
        path: filePath,
        ...(tab.workspaceId ? { workspaceId: tab.workspaceId } : {})
      });
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, filePath, {
            content: result.content,
            savedContent: result.content,
            mtimeMs: result.mtimeMs,
            truncated: result.truncated,
            staleOnDisk: false,
            agentStreaming: false,
            error: null,
            eol: result.eol,
            encoding: result.encoding,
            utf8Bom: result.utf8Bom
          })
        })
      );
    } catch {
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, filePath, { staleOnDisk: true })
        })
      );
    }
  },

  save: async () => {
    const { activeFilePath, workspaceId, content, mtimeMs, saving } = get();
    if (!activeFilePath || saving) return false;
    const tab = get().tabs.find(
      (t) => normalizePath(t.filePath) === normalizePath(activeFilePath)
    );
    if (!tab || tab.content === tab.savedContent) return true;
    cancelAutoSave(activeFilePath);
    set((state) =>
      mirrorActiveTab({
        ...state,
        tabs: updateTab(state.tabs, activeFilePath, { saving: true, error: null })
      })
    );
    try {
      const reply = await vyotiq.editor.write({
        path: activeFilePath,
        content,
        ...(workspaceId ? { workspaceId } : {}),
        ...(mtimeMs != null ? { expectedMtimeMs: mtimeMs } : {})
      });
      if (!reply.ok) {
        set((state) =>
          mirrorActiveTab({
            ...state,
            tabs: updateTab(state.tabs, activeFilePath, { saving: false, staleOnDisk: true })
          })
        );
        useToastStore.getState().show(
          'File changed on disk — reload or save again to overwrite.',
          'danger'
        );
        return false;
      }
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, activeFilePath, {
            savedContent: content,
            mtimeMs: reply.mtimeMs,
            saving: false,
            staleOnDisk: false
          })
        })
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, activeFilePath, { saving: false, error: msg })
        })
      );
      useToastStore.getState().show(msg, 'danger');
      return false;
    }
  },

  markStaleOnDisk: (filePath) => {
    const target = filePath ?? get().activeFilePath;
    if (!target) return;
    void get().refreshTabFromDisk(target);
  },

  applyExternalContent: (filePath, content, mtimeMs) => {
    const tab = get().tabs.find((t) => normalizePath(t.filePath) === normalizePath(filePath));
    if (!tab) return;
    const dirty = tab.content !== tab.savedContent;
    if (dirty) {
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, filePath, { staleOnDisk: true })
        })
      );
      return;
    }
    set((state) =>
      mirrorActiveTab({
        ...state,
        tabs: updateTab(state.tabs, filePath, {
          content,
          ...(mtimeMs !== undefined ? { mtimeMs } : {}),
          staleOnDisk: false,
          agentStreaming: true
        })
      })
    );
  },

  setAgentStreaming: (filePath, streaming) => {
    set((state) =>
      mirrorActiveTab({
        ...state,
        tabs: updateTab(state.tabs, filePath, { agentStreaming: streaming })
      })
    );
  },

  requestReveal: (filePath, line, character) => {
    pendingReveal.set(normalizePath(filePath), { line, character });
  },

  consumeReveal: (filePath) => {
    const id = normalizePath(filePath);
    const value = pendingReveal.get(id) ?? null;
    if (value) pendingReveal.delete(id);
    return value;
  }
}));

export function selectEditorDirty(s: EditorStore): boolean {
  const tab =
    s.activeFilePath != null
      ? s.tabs.find((t) => normalizePath(t.filePath) === normalizePath(s.activeFilePath!))
      : null;
  return s.open && tab != null && tab.content !== tab.savedContent;
}

export function editorMatchesPath(s: EditorStore, filePath: string): boolean {
  const id = normalizePath(filePath);
  return s.open && s.tabs.some((t) => normalizePath(t.filePath) === id);
}

export function selectActiveEditorTab(s: EditorStore): EditorTab | null {
  if (!s.activeFilePath) return null;
  return (
    s.tabs.find((t) => normalizePath(t.filePath) === normalizePath(s.activeFilePath!)) ?? null
  );
}
