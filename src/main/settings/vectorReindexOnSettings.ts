/**
 * Re-index workspace vector stores when embedder settings change.
 */

import { BrowserWindow } from 'electron';
import { IPC } from '@shared/constants.js';
import { resolveVectorMemorySettings } from '@shared/settings/vectorMemorySettings.js';
import type { AppSettings } from '@shared/types/ipc.js';
import { forceReindexWorkspace } from '../memory/vector/indexScheduler.js';
import { listWorkspaces } from '../workspace/workspaceState.js';
import { logger } from '../logging/logger.js';

const log = logger.child('settings/vectorReindex');

export function pushVectorReindexProgress(payload: {
  phase: 'start' | 'workspace' | 'done' | 'error';
  workspaceId?: string;
  workspaceLabel?: string;
  index?: number;
  total?: number;
  message?: string;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.MEMORY_REINDEX_PROGRESS, payload);
  }
}

function vectorMemoryFingerprint(settings: AppSettings): string {
  const vm = resolveVectorMemorySettings(settings.ui);
  return `${vm.embedder}|${vm.ollamaBaseUrl}|${vm.ollamaModel}`;
}

export async function reindexAllWorkspacesIfVectorMemoryChanged(
  before: AppSettings,
  after: AppSettings
): Promise<void> {
  if (vectorMemoryFingerprint(before) === vectorMemoryFingerprint(after)) return;
  const state = await listWorkspaces();
  const total = state.workspaces.length;
  pushVectorReindexProgress({ phase: 'start', total });
  let index = 0;
  for (const ws of state.workspaces) {
    index += 1;
    pushVectorReindexProgress({
      phase: 'workspace',
      workspaceId: ws.id,
      workspaceLabel: ws.label,
      index,
      total
    });
    try {
      await forceReindexWorkspace(ws.path);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('vector re-index failed after embedder change', {
        workspaceId: ws.id,
        err: message
      });
      pushVectorReindexProgress({
        phase: 'error',
        workspaceId: ws.id,
        workspaceLabel: ws.label,
        message
      });
    }
  }
  pushVectorReindexProgress({ phase: 'done', total });
}
