/**
 * Workspace terminal panel open/close state.
 */

import { create } from 'zustand';
import { vyotiq } from '../lib/ipc.js';
import { closeSettingsForCompanionOpen } from './useAppViewStore.js';
import { useAttachmentPreviewStore } from './useAttachmentPreviewStore.js';
import { useEditorStore } from './useEditorStore.js';

interface TerminalStore {
  open: boolean;
  workspaceId: string | null;
  shellLabel: string | null;
  attaching: boolean;
  error: string | null;
  toggle: (workspaceId: string | null) => void;
  openPanel: (workspaceId: string) => Promise<void>;
  close: () => void;
  setShellLabel: (label: string) => void;
  setAttaching: (attaching: boolean) => void;
  setError: (error: string | null) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  open: false,
  workspaceId: null,
  shellLabel: null,
  attaching: false,
  error: null,

  toggle: (workspaceId) => {
    if (!workspaceId) return;
    if (get().open && get().workspaceId === workspaceId) {
      get().close();
      return;
    }
    void get().openPanel(workspaceId);
  },

  openPanel: async (workspaceId) => {
    closeSettingsForCompanionOpen();
    useAttachmentPreviewStore.getState().close();
    useEditorStore.getState().close();
    set({ open: true, workspaceId, attaching: true, error: null, shellLabel: null });
    try {
      const meta = await vyotiq.terminal.attach({ workspaceId });
      set({ attaching: false, shellLabel: meta.shell });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ attaching: false, error: msg, open: false, workspaceId: null });
    }
  },

  close: () => {
    const { workspaceId } = get();
    if (workspaceId) {
      void vyotiq.terminal.detach(workspaceId).catch(() => {
        /* detach is best-effort when panel closes */
      });
    }
    set({ open: false, workspaceId: null, shellLabel: null, attaching: false, error: null });
  },

  setShellLabel: (label) => set({ shellLabel: label }),
  setAttaching: (attaching) => set({ attaching }),
  setError: (error) => set({ error })
}));
