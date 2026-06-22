/**
 * Subscribe to main-process workspace tree change pushes.
 */

import { useEffect } from 'react';
import { scheduleWorkspaceTreeRefresh } from '../lib/scheduleWorkspaceTreeRefresh.js';
import { subscribeWorkspaceTreeChanged } from '../lib/workspaceTreeChangeHub.js';
import { useWorkspaceStore } from '../store/useWorkspaceStore.js';

export function useWorkspaceTreeWatcher(): void {
  useEffect(() => {
    return subscribeWorkspaceTreeChanged((payload) => {
      const activeId = useWorkspaceStore.getState().activeId;
      if (activeId && payload.workspaceId !== activeId) return;
      scheduleWorkspaceTreeRefresh();
    });
  }, []);
}
