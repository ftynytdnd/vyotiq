/**
 * Terminal PTY IPC — shared workspace shell for user + agent bash.
 */

import { IPC } from '@shared/constants.js';
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalInputPayload,
  TerminalResizePayload
} from '@shared/types/terminal.js';
import {
  disposeAllPtySessions,
  ensureWorkspacePty,
  killWorkspacePty,
  resizeWorkspacePty,
  setPtyEventHandlers,
  writeWorkspacePty
} from '../terminal/ptyManager.js';
import { requireWorkspace, requireWorkspaceById, getActiveWorkspace } from '../workspace/workspaceState.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertNumber, assertObject, assertOptionalString, assertString } from './validate.js';

async function resolveWorkspace(id?: string): Promise<{ id: string; path: string }> {
  if (id) {
    const path = await requireWorkspaceById(id);
    return { id, path };
  }
  const path = await requireWorkspace();
  const active = await getActiveWorkspace();
  if (!active?.id) throw new Error('No active workspace');
  return { id: active.id, path };
}

export function registerTerminalIpc(): void {
  setPtyEventHandlers({
    onData: (workspaceId, data) => {
      safeWebContentsSend(IPC.TERMINAL_DATA, { workspaceId, data });
    },
    onExit: (workspaceId, exitCode, signal) => {
      safeWebContentsSend(IPC.TERMINAL_EXIT, { workspaceId, exitCode, ...(signal !== undefined ? { signal } : {}) });
    }
  });

  wrapIpcHandler(
    IPC.TERMINAL_ATTACH,
    async (_event, input: TerminalAttachInput): Promise<TerminalAttachResult> => {
      assertObject('terminal:attach', 'input', input);
      assertString('terminal:attach', 'workspaceId', input.workspaceId);
      const ws = await resolveWorkspace(input.workspaceId);
      const meta = ensureWorkspacePty(ws.id, ws.path);
      return { ok: true, ...meta };
    }
  );

  wrapIpcHandler(IPC.TERMINAL_INPUT, async (_event, input: TerminalInputPayload) => {
    assertObject('terminal:input', 'input', input);
    assertString('terminal:input', 'workspaceId', input.workspaceId);
    assertString('terminal:input', 'data', input.data, { nonEmpty: false, maxBytes: 64 * 1024 });
    writeWorkspacePty(input.workspaceId, input.data);
  });

  wrapIpcHandler(IPC.TERMINAL_RESIZE, async (_event, input: TerminalResizePayload) => {
    assertObject('terminal:resize', 'input', input);
    assertString('terminal:resize', 'workspaceId', input.workspaceId);
    assertNumber('terminal:resize', 'cols', input.cols, { integer: true, min: 20, max: 500 });
    assertNumber('terminal:resize', 'rows', input.rows, { integer: true, min: 4, max: 200 });
    resizeWorkspacePty(input.workspaceId, input.cols, input.rows);
  });

  wrapIpcHandler(IPC.TERMINAL_RESTART, async (_event, workspaceId?: string) => {
    assertOptionalString('terminal:restart', 'workspaceId', workspaceId);
    const ws = await resolveWorkspace(workspaceId);
    killWorkspacePty(ws.id);
    ensureWorkspacePty(ws.id, ws.path);
  });

  /** Closing the terminal panel detaches the renderer only — PTY stays alive for agent bash reuse. */
  wrapIpcHandler(IPC.TERMINAL_DETACH, async (_event, workspaceId?: string) => {
    assertOptionalString('terminal:detach', 'workspaceId', workspaceId);
    void workspaceId;
  });
}

export function teardownTerminalIpc(): void {
  disposeAllPtySessions();
}
