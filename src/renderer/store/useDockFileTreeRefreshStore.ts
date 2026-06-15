/**
 * Bumped when the workspace filesystem changes (watcher push or CRUD).
 * DockFileTree subscribes to refetch the tree.
 */

import { create } from 'zustand';

interface DockFileTreeRefreshState {
  version: number;
  bump: () => void;
}

export const useDockFileTreeRefreshStore = create<DockFileTreeRefreshState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 }))
}));
