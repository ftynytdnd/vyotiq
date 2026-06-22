/**
 * Fan-out hub for `workspace:tree-changed` — one IPC subscription, many consumers.
 */

import type { WorkspaceTreeChangedPayload } from '@shared/types/ipc.js';
import { vyotiq } from './ipc.js';

type WorkspaceTreeChangeListener = (payload: WorkspaceTreeChangedPayload) => void;

const listeners = new Set<WorkspaceTreeChangeListener>();

interface HubGlobals {
  __vyotiqWorkspaceTreeChangeUnsub?: () => void;
}

const globalsRef = globalThis as unknown as HubGlobals;

export function subscribeWorkspaceTreeChanged(
  listener: WorkspaceTreeChangeListener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function dispatchWorkspaceTreeChanged(payload: WorkspaceTreeChangedPayload): void {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      /* isolate subscriber failures */
    }
  }
}

/** Wire the single IPC push channel. Safe to call on every boot / HMR. */
export function bootstrapWorkspaceTreeChangeHub(): void {
  globalsRef.__vyotiqWorkspaceTreeChangeUnsub?.();
  globalsRef.__vyotiqWorkspaceTreeChangeUnsub = vyotiq.workspace.onTreeChanged(
    dispatchWorkspaceTreeChanged
  );
}
