/**
 * Subscribe to main-process workspace tree change pushes.
 */

import { useEffect } from 'react';
import { vyotiq } from '../lib/ipc.js';
import { scheduleWorkspaceTreeRefresh } from '../lib/scheduleWorkspaceTreeRefresh.js';
import { useWorkspaceStore } from '../store/useWorkspaceStore.js';

export function useWorkspaceTreeWatcher(): void {
  useEffect(() => {
    const unsub = vyotiq.workspace.onTreeChanged((payload) => {
      const activeId = useWorkspaceStore.getState().activeId;
      if (activeId && payload.workspaceId !== activeId) return;
      scheduleWorkspaceTreeRefresh();
    });
    return unsub;
  }, []);
}
