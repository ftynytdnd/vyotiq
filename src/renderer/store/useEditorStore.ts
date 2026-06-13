/**
 * Zustand store for the in-app workspace editor (secondary zone).
 */

import { create } from 'zustand';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
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

interface EditorStore {
  open: boolean;
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
  setContent: (content: string) => void;
  reloadFromDisk: () => Promise<void>;
  save: () => Promise<boolean>;
  markStaleOnDisk: () => void;
  applyExternalContent: (content: string, mtimeMs?: number) => void;
}

function pathsEqual(a: string | null, b: string): boolean {
  if (!a) return false;
  return a.replace(/\\/g, '/') === b.replace(/\\/g, '/');
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  open: false,
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

    if (opts.initialContent !== undefined) {
      set({
        open: true,
        filePath,
        workspaceId: opts.workspaceId ?? null,
        content: opts.initialContent,
        savedContent: opts.initialContent,
        mtimeMs: opts.initialMtimeMs ?? null,
        truncated: false,
        loading: false,
        saving: false,
        staleOnDisk: false,
        error: null
      });
      return;
    }

    set({
      open: true,
      filePath,
      workspaceId: opts.workspaceId ?? null,
      loading: true,
      error: null,
      staleOnDisk: false
    });

    try {
      const result = await vyotiq.editor.read({
        path: filePath,
        ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {})
      });
      set({
        content: result.content,
        savedContent: result.content,
        mtimeMs: result.mtimeMs,
        truncated: result.truncated,
        loading: false
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Could not open ${basenameFromPath(filePath)}: ${msg}`, 'danger');
      set({ loading: false, error: msg, open: false, filePath: null });
    }
  },

  close: () => {
    set({
      open: false,
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

  setContent: (content) => set({ content, staleOnDisk: false }),

  reloadFromDisk: async () => {
    const { filePath, workspaceId } = get();
    if (!filePath) return;
    set({ loading: true, error: null });
    try {
      const result = await vyotiq.editor.read({
        path: filePath,
        ...(workspaceId ? { workspaceId } : {})
      });
      set({
        content: result.content,
        savedContent: result.content,
        mtimeMs: result.mtimeMs,
        truncated: result.truncated,
        loading: false,
        staleOnDisk: false
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: msg });
      useToastStore.getState().show(msg, 'danger');
    }
  },

  save: async () => {
    const { filePath, workspaceId, content, mtimeMs, saving } = get();
    if (!filePath || saving) return false;
    set({ saving: true, error: null });
    try {
      const reply = await vyotiq.editor.write({
        path: filePath,
        content,
        ...(workspaceId ? { workspaceId } : {}),
        ...(mtimeMs != null ? { expectedMtimeMs: mtimeMs } : {})
      });
      if (!reply.ok) {
        set({ saving: false, staleOnDisk: true });
        useToastStore.getState().show(
          'File changed on disk — reload or save again to overwrite.',
          'danger'
        );
        return false;
      }
      set({
        savedContent: content,
        mtimeMs: reply.mtimeMs,
        saving: false,
        staleOnDisk: false
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ saving: false, error: msg });
      useToastStore.getState().show(msg, 'danger');
      return false;
    }
  },

  markStaleOnDisk: () => {
    const { filePath, open } = get();
    if (!open || !filePath) return;
    const dirty = get().content !== get().savedContent;
    if (dirty) {
      set({ staleOnDisk: true });
    } else {
      void get().reloadFromDisk();
    }
  },

  applyExternalContent: (content, mtimeMs) => {
    const { filePath, open } = get();
    if (!open || !filePath) return;
    const dirty = get().content !== get().savedContent;
    if (dirty) {
      set({ staleOnDisk: true });
      return;
    }
    set({
      content,
      savedContent: content,
      ...(mtimeMs !== undefined ? { mtimeMs } : {}),
      staleOnDisk: false
    });
  }
}));

export function selectEditorDirty(s: EditorStore): boolean {
  return s.open && s.content !== s.savedContent;
}

export function editorMatchesPath(s: EditorStore, filePath: string): boolean {
  return s.open && pathsEqual(s.filePath, filePath);
}
