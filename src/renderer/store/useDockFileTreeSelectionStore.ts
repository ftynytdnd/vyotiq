/**
 * Shared file-tree selection state — syncs dock tree and open editors.
 */

import { create } from 'zustand';

interface DockFileTreeSelectionStore {
  workspaceId: string | null;
  paths: string[];
  setWorkspaceSelection: (workspaceId: string, paths: Iterable<string>) => void;
  togglePath: (workspaceId: string, path: string) => void;
  clearWorkspaceSelection: (workspaceId: string) => void;
}

export const useDockFileTreeSelectionStore = create<DockFileTreeSelectionStore>((set, get) => ({
  workspaceId: null,
  paths: [],
  setWorkspaceSelection: (workspaceId, paths) => {
    set({ workspaceId, paths: Array.from(paths) });
  },
  togglePath: (workspaceId, path) => {
    const state = get();
    if (state.workspaceId !== workspaceId) {
      set({ workspaceId, paths: [path] });
      return;
    }
    const next = new Set(state.paths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    set({ paths: Array.from(next) });
  },
  clearWorkspaceSelection: (workspaceId) => {
    const state = get();
    if (state.workspaceId === workspaceId) {
      set({ workspaceId: null, paths: [] });
    }
  }
}));

export function dockTreeSelectedPaths(workspaceId: string | null): ReadonlySet<string> {
  const state = useDockFileTreeSelectionStore.getState();
  if (!workspaceId || state.workspaceId !== workspaceId) return new Set();
  return new Set(state.paths);
}
