/**
 * Workspace terminal state — multiple PTY sessions per workspace with an
 * optional side-by-side split. The primary session is shared with the
 * agent `bash` tool (managed in main); extra sessions are user-only.
 */

import { create } from 'zustand';
import type { TerminalSessionMeta } from '@shared/types/terminal.js';
import { vyotiq } from '../lib/ipc.js';
import { closeSettingsForCompanionOpen } from './useAppViewStore.js';
import { useAttachmentPreviewStore } from './useAttachmentPreviewStore.js';
import {
  focusWorkbenchTab,
  syncWorkbenchTabAfterClose
} from '../components/workbench/workbenchShared.js';
import { useUiStore } from './useUiStore.js';
import { disposeTerminalEntry } from '../components/terminal/terminalPool.js';

interface TerminalStore {
  open: boolean;
  workspaceId: string | null;
  sessions: TerminalSessionMeta[];
  activeSessionId: string | null;
  /** Secondary (right) pane session when split; null = single pane. */
  splitSessionId: string | null;
  attaching: boolean;
  error: string | null;
  /** Find-in-scrollback overlay visibility. */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  toggle: (workspaceId: string | null) => void;
  openPanel: (workspaceId: string) => Promise<void>;
  close: () => void;
  createSession: () => Promise<void>;
  closeSession: (sessionId: string) => Promise<void>;
  selectSession: (sessionId: string) => void;
  toggleSplit: () => Promise<void>;
  restart: (sessionId: string) => Promise<void>;
  handleExit: (sessionId: string) => void;
  setError: (error: string | null) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  open: false,
  workspaceId: null,
  sessions: [],
  activeSessionId: null,
  splitSessionId: null,
  attaching: false,
  error: null,
  searchOpen: false,

  setSearchOpen: (open) => set({ searchOpen: open }),

  toggle: (workspaceId) => {
    if (!workspaceId) return;
    const { open, workspaceId: currentWs } = get();
    if (open && currentWs === workspaceId) {
      if (useUiStore.getState().workbenchTab === 'terminal') {
        get().close();
        return;
      }
      focusWorkbenchTab('terminal');
      return;
    }
    void get().openPanel(workspaceId);
  },

  openPanel: async (workspaceId) => {
    closeSettingsForCompanionOpen();
    useAttachmentPreviewStore.getState().close();
    focusWorkbenchTab('terminal');
    set({ open: true, workspaceId, attaching: true, error: null });
    try {
      const reply = await vyotiq.terminal.attach({ workspaceId });
      const sessions = reply.sessions;
      const current = get().activeSessionId;
      const activeStillValid = current && sessions.some((s) => s.sessionId === current);
      const primary = sessions.find((s) => s.primary) ?? sessions[0] ?? null;
      set({
        attaching: false,
        sessions,
        activeSessionId: activeStillValid ? current : primary?.sessionId ?? null
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ attaching: false, error: msg, open: false, workspaceId: null, sessions: [] });
      syncWorkbenchTabAfterClose();
    }
  },

  close: () => {
    const { workspaceId } = get();
    if (workspaceId) {
      void vyotiq.terminal.detach(workspaceId).catch(() => {
        /* detach is best-effort when the panel closes */
      });
    }
    set({ open: false });
    syncWorkbenchTabAfterClose();
  },

  createSession: async () => {
    const { workspaceId } = get();
    if (!workspaceId) return;
    try {
      const reply = await vyotiq.terminal.create({ workspaceId });
      set((s) => ({
        sessions: [...s.sessions, reply.session],
        activeSessionId: reply.session.sessionId
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  closeSession: async (sessionId) => {
    try {
      await vyotiq.terminal.close({ sessionId });
    } catch {
      /* main may have already reaped it */
    }
    get().handleExit(sessionId);
  },

  handleExit: (sessionId) => {
    disposeTerminalEntry(sessionId);
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.sessionId !== sessionId);
      if (sessions.length === 0) {
        return {
          sessions,
          activeSessionId: null,
          splitSessionId: null
        };
      }
      let activeSessionId = s.activeSessionId;
      if (activeSessionId === sessionId) {
        activeSessionId = sessions[0]!.sessionId;
      }
      const splitSessionId = s.splitSessionId === sessionId ? null : s.splitSessionId;
      return { sessions, activeSessionId, splitSessionId };
    });
    if (get().sessions.length === 0) {
      get().close();
    }
  },

  selectSession: (sessionId) => {
    set((s) => {
      if (s.splitSessionId === sessionId) {
        // Selecting the split pane swaps it into the primary slot.
        return { activeSessionId: sessionId, splitSessionId: s.activeSessionId };
      }
      return { activeSessionId: sessionId };
    });
  },

  toggleSplit: async () => {
    const { splitSessionId, sessions, activeSessionId } = get();
    if (splitSessionId) {
      set({ splitSessionId: null });
      return;
    }
    const other = sessions.find((s) => s.sessionId !== activeSessionId);
    if (other) {
      set({ splitSessionId: other.sessionId });
      return;
    }
    // Need a second session to split against.
    const { workspaceId } = get();
    if (!workspaceId) return;
    try {
      const reply = await vyotiq.terminal.create({ workspaceId });
      set((s) => ({
        sessions: [...s.sessions, reply.session],
        splitSessionId: reply.session.sessionId
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  restart: async (sessionId) => {
    try {
      const reply = await vyotiq.terminal.restart({ sessionId });
      disposeTerminalEntry(sessionId);
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.sessionId === sessionId ? reply.session : sess
        ),
        activeSessionId: s.activeSessionId === sessionId ? reply.session.sessionId : s.activeSessionId,
        splitSessionId: s.splitSessionId === sessionId ? reply.session.sessionId : s.splitSessionId
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  setError: (error) => set({ error })
}));
