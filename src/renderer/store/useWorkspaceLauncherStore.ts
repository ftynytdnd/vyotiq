/**
 * Global workspace launcher state — dock flyout or elevated portal.
 */

import { create } from 'zustand';
import { useDockSearchStore } from './useDockSearchStore.js';
import { useDockSchedulesStore } from './useDockSchedulesStore.js';

export type WorkspaceLauncherSource = 'all' | 'local' | 'github';
export type WorkspaceLauncherPlacement = 'inline' | 'elevated';

interface WorkspaceLauncherOpenOpts {
  source?: WorkspaceLauncherSource;
  placement?: WorkspaceLauncherPlacement;
}

interface WorkspaceLauncherStore {
  open: boolean;
  query: string;
  sourceFilter: WorkspaceLauncherSource;
  placement: WorkspaceLauncherPlacement;
  setOpen: (open: boolean, opts?: WorkspaceLauncherOpenOpts) => void;
  setQuery: (query: string) => void;
  setSourceFilter: (source: WorkspaceLauncherSource) => void;
}

function closeSiblingDockFlyouts(): void {
  useDockSearchStore.getState().setOpen(false);
  useDockSchedulesStore.getState().setOpen(false);
}

export const useWorkspaceLauncherStore = create<WorkspaceLauncherStore>((set, get) => ({
  open: false,
  query: '',
  sourceFilter: 'all',
  placement: 'inline',
  setOpen: (open, opts) => {
    if (open) {
      closeSiblingDockFlyouts();
      set({
        open: true,
        query: '',
        sourceFilter: opts?.source ?? 'all',
        placement: opts?.placement ?? 'inline'
      });
      return;
    }
    set({ open: false, query: '' });
  },
  setQuery: (query) => set({ query }),
  setSourceFilter: (sourceFilter) => set({ sourceFilter })
}));

export function openWorkspaceLauncher(
  source: WorkspaceLauncherSource = 'all',
  placement: WorkspaceLauncherPlacement = 'inline'
): void {
  useWorkspaceLauncherStore.getState().setOpen(true, { source, placement });
}

/** @deprecated Use openWorkspaceLauncher */
export function openWorkspaceDialog(tab: 'local' | 'github' = 'local'): void {
  const source: WorkspaceLauncherSource = tab === 'github' ? 'github' : 'local';
  openWorkspaceLauncher(source, 'inline');
}

/** @deprecated Use useWorkspaceLauncherStore */
export const useOpenWorkspaceDialogStore = useWorkspaceLauncherStore;
