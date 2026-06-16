/**
 * Shared file-tree selection state — syncs dock tree and open editors.
 */

import { create } from 'zustand';

interface DockFileTreeSelectionStore {
  workspaceId: string | null;
  paths: string[];
  setWorkspaceSelection: (workspaceId: string, paths: Iterable<string>) => void;
  clearWorkspaceSelection: (workspaceId: string) => void;
}

export const useDockFileTreeSelectionStore = create<DockFileTreeSelectionStore>((set, get) => ({
  workspaceId: null,
  paths: [],
  setWorkspaceSelection: (workspaceId, paths) => {
    set({ workspaceId, paths: Array.from(paths) });
  },
  clearWorkspaceSelection: (workspaceId) => {
    const state = get();
    if (state.workspaceId === workspaceId) {
      set({ workspaceId: null, paths: [] });
    }
  }
}));
