/**
 * Debounced workspace tree refresh — coalesce rapid fs.watch bursts
 * (agent batch edits, vector index) into a single dock refetch.
 */

import { invalidateWorkspaceTreeCache } from '../lib/workspaceTreeCache.js';
import { invalidateWorkspaceChildrenCache } from '../lib/workspaceChildrenCache.js';
import { useDockFileTreeRefreshStore } from '../store/useDockFileTreeRefreshStore.js';

const TREE_REFRESH_DEBOUNCE_MS = 800;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleWorkspaceTreeRefresh(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    invalidateWorkspaceTreeCache();
    invalidateWorkspaceChildrenCache();
    useDockFileTreeRefreshStore.getState().bump();
  }, TREE_REFRESH_DEBOUNCE_MS);
}

/** Test-only reset. */
export function __test_resetWorkspaceTreeRefreshDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}
