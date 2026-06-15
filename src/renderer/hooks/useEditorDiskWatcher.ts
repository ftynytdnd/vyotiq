/**
 * Sync open editor tabs when the workspace filesystem changes.
 */

import { useEffect } from 'react';
import { vyotiq } from '../lib/ipc.js';
import { useEditorStore } from '../store/useEditorStore.js';

const DISK_SYNC_DEBOUNCE_MS = 500;

export function useEditorDiskWatcher(): void {
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const unsub = vyotiq.workspace.onTreeChanged((payload) => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const { tabs, refreshTabFromDisk } = useEditorStore.getState();
        for (const tab of tabs) {
          if (tab.workspaceId && tab.workspaceId !== payload.workspaceId) continue;
          void refreshTabFromDisk(tab.filePath);
        }
      }, DISK_SYNC_DEBOUNCE_MS);
    });

    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      unsub();
    };
  }, []);
}
