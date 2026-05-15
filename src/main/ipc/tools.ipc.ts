/**
 * Tools IPC. Mostly small renderer helpers (open file in OS, confirm bus
 * responses).
 */

import { shell } from 'electron';
import { IPC } from '@shared/constants.js';
import { settleConfirm } from '../orchestrator/confirmBus.js';
import type { ConfirmResponse } from '@shared/types/ipc.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import {
  requireWorkspace,
  requireWorkspaceById
} from '../workspace/workspaceState.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';

const log = logger.child('ipc/tools');

export function registerToolsIpc(): void {
  // `workspaceId` is optional; when supplied, the path is resolved
  // against THAT workspace's root rather than the active workspace's.
  // The report card threads it through whenever it knows which
  // workspace owns the file so an "open externally" click never
  // silently lands on a different workspace's same-relative path
  // after the active workspace has drifted.
  wrapIpcHandler(IPC.TOOLS_OPEN_PATH, async (_event, path: string, workspaceId?: string) => {
    const ws = workspaceId
      ? await requireWorkspaceById(workspaceId)
      : await requireWorkspace();
    // Symlink-aware containment check. The lexical `isInsideWorkspace`
    // pre-check used here previously let a workspace-rooted symlink
    // (`vendor -> /etc`) redirect `shell.openPath` at an arbitrary OS
    // file — the lexical resolution stayed inside the sandbox even
    // though the canonicalised target did not. `realpathInsideWorkspace`
    // follows every symlink on the path and rejects targets that
    // escape the workspace; it falls back to the lexical resolution
    // for paths that don't yet exist (ENOENT), which is fine because
    // `shell.openPath` then surfaces its own user-facing error.
    let abs: string;
    try {
      abs = await realpathInsideWorkspace(ws, path);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('refused to open path outside workspace', { path, err: msg });
      throw new Error(msg);
    }
    const result = await shell.openPath(abs);
    if (result) {
      // Non-empty string from shell.openPath signals a failure.
      log.warn('shell.openPath failed', { path: abs, message: result });
      throw new Error(result);
    }
  });

  wrapIpcHandler(
    IPC.TOOLS_CONFIRM_RESPONSE,
    async (_event, id: string, reply: ConfirmResponse) => {
      // Legacy callers send a bare boolean; `EditApprovalDialog` sends
      // `{ approved, acceptAllRemaining }`. `settleConfirm` normalizes
      // both shapes.
      settleConfirm(id, reply);
    }
  );
}
