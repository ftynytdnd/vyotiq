/**
 * Zustand store for the in-app workspace editor (secondary zone) with multi-tab support.
 */

import { create } from 'zustand';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { normalizePath } from '../lib/normalizePath.js';
import { vyotiq } from '../lib/ipc.js';
import { closeSettingsForCompanionOpen } from './useAppViewStore.js';
import { useAttachmentPreviewStore } from './useAttachmentPreviewStore.js';
import { useToastStore } from './useToastStore.js';

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
  close: () => void;
  closeTab: (filePath: string) => void;
  setActiveTab: (filePath: string) => void;
  setContent: (content: string) => void;
  reloadFromDisk: () => Promise<void>;
  save: () => Promise<boolean>;
  markStaleOnDisk: (filePath?: string) => void;
  applyExternalContent: (filePath: string, content: string, mtimeMs?: number) => void;
  /** Scroll active editor to LSP go-to-definition target after tab switch. */
  requestReveal: (filePath: string, line: number, character: number) => void;
  consumeReveal: (filePath: string) => { line: number; character: number } | null;
}

function emptyTabFields(): Pick<
  EditorTab,
  'content' | 'savedContent' | 'mtimeMs' | 'truncated' | 'loading' | 'saving' | 'staleOnDisk' | 'error'
> {
  return {
    content: '',
    savedContent: '',
    mtimeMs: null,
    truncated: false,
    loading: false,
    saving: false,
    staleOnDisk: false,
    error: null
  };
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

  openFile: async (filePath, opts = {}) => {
    closeSettingsForCompanionOpen();
    useAttachmentPreviewStore.getState().close();

    const id = normalizePath(filePath);
    const existing = get().tabs.find((t) => normalizePath(t.filePath) === id);
    if (existing) {
      set(mirrorActiveTab({ ...get(), open: true, activeFilePath: existing.filePath }));
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
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, filePath, {
            content: result.content,
            savedContent: result.content,
            mtimeMs: result.mtimeMs,
            truncated: result.truncated,
            loading: false
          })
        })
      );
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
      error: null
    });
  },

  closeTab: (filePath) => {
    const id = normalizePath(filePath);
    set((state) => {
      const tabs = state.tabs.filter((t) => normalizePath(t.filePath) !== id);
      let activeFilePath = state.activeFilePath;
      if (activeFilePath && normalizePath(activeFilePath) === id) {
        activeFilePath = tabs.length > 0 ? tabs[tabs.length - 1]!.filePath : null;
      }
      return mirrorActiveTab({
        ...state,
        tabs,
        activeFilePath,
        open: tabs.length > 0
      });
    });
  },

  setActiveTab: (filePath) => {
    const id = normalizePath(filePath);
    if (!get().tabs.some((t) => normalizePath(t.filePath) === id)) return;
    set(mirrorActiveTab({ ...get(), activeFilePath: filePath }));
  },

  setContent: (content) => {
    const { activeFilePath } = get();
    if (!activeFilePath) return;
    set((state) =>
      mirrorActiveTab({
        ...state,
        tabs: updateTab(state.tabs, activeFilePath, { content, staleOnDisk: false })
      })
    );
  },

  reloadFromDisk: async () => {
    const { activeFilePath, workspaceId } = get();
    if (!activeFilePath) return;
    set((state) =>
      mirrorActiveTab({
        ...state,
        tabs: updateTab(state.tabs, activeFilePath, { loading: true, error: null })
      })
    );
    try {
      const result = await vyotiq.editor.read({
        path: activeFilePath,
        ...(workspaceId ? { workspaceId } : {})
      });
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, activeFilePath, {
            content: result.content,
            savedContent: result.content,
            mtimeMs: result.mtimeMs,
            truncated: result.truncated,
            loading: false,
            staleOnDisk: false
          })
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, activeFilePath, { loading: false, error: msg })
        })
      );
      useToastStore.getState().show(msg, 'danger');
    }
  },

  save: async () => {
    const { activeFilePath, workspaceId, content, mtimeMs, saving } = get();
    if (!activeFilePath || saving) return false;
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
    const tab = get().tabs.find((t) => normalizePath(t.filePath) === normalizePath(target));
    if (!tab) return;
    const dirty = tab.content !== tab.savedContent;
    if (dirty) {
      set((state) =>
        mirrorActiveTab({
          ...state,
          tabs: updateTab(state.tabs, target, { staleOnDisk: true })
        })
      );
    } else {
      void get().reloadFromDisk();
    }
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
          savedContent: content,
          ...(mtimeMs !== undefined ? { mtimeMs } : {}),
          staleOnDisk: false
        })
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
