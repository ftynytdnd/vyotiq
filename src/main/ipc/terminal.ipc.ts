/**
 * Terminal PTY IPC — multi-session workspace shells for user + agent bash.
 */

import { IPC } from '@shared/constants.js';
import type {
  TerminalAttachInput,
  TerminalAttachResult,
  TerminalCloseInput,
  TerminalCreateInput,
  TerminalCreateResult,
  TerminalInputPayload,
  TerminalResizePayload,
  TerminalRestartInput
} from '@shared/types/terminal.js';
import {
  createWorkspaceSession,
  disposeAllPtySessions,
  ensureWorkspacePty,
  getSessionMeta,
  killSession,
  listWorkspaceSessions,
  resizeSession,
  restartSession,
  setPtyEventHandlers,
  writeSession
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
    onData: (event) => {
      safeWebContentsSend(IPC.TERMINAL_DATA, event);
    },
    onExit: (event) => {
      safeWebContentsSend(IPC.TERMINAL_EXIT, event);
    }
  });

  wrapIpcHandler(
    IPC.TERMINAL_ATTACH,
    async (_event, input: TerminalAttachInput): Promise<TerminalAttachResult> => {
      assertObject('terminal:attach', 'input', input);
      assertString('terminal:attach', 'workspaceId', input.workspaceId);
      const ws = await resolveWorkspace(input.workspaceId);
      ensureWorkspacePty(ws.id, ws.path);
      return { ok: true, sessions: listWorkspaceSessions(ws.id) };
    }
  );

  wrapIpcHandler(
    IPC.TERMINAL_CREATE,
    async (_event, input: TerminalCreateInput): Promise<TerminalCreateResult> => {
      assertObject('terminal:create', 'input', input);
      assertString('terminal:create', 'workspaceId', input.workspaceId);
      const ws = await resolveWorkspace(input.workspaceId);
      const session = createWorkspaceSession(ws.id, ws.path);
      return { ok: true, session };
    }
  );

  wrapIpcHandler(IPC.TERMINAL_CLOSE, async (_event, input: TerminalCloseInput) => {
    assertObject('terminal:close', 'input', input);
    assertString('terminal:close', 'sessionId', input.sessionId);
    killSession(input.sessionId);
  });

  wrapIpcHandler(IPC.TERMINAL_INPUT, async (_event, input: TerminalInputPayload) => {
    assertObject('terminal:input', 'input', input);
    assertString('terminal:input', 'sessionId', input.sessionId);
    assertString('terminal:input', 'data', input.data, { nonEmpty: false, maxBytes: 64 * 1024 });
    writeSession(input.sessionId, input.data);
  });

  wrapIpcHandler(IPC.TERMINAL_RESIZE, async (_event, input: TerminalResizePayload) => {
    assertObject('terminal:resize', 'input', input);
    assertString('terminal:resize', 'sessionId', input.sessionId);
    assertNumber('terminal:resize', 'cols', input.cols, { integer: true, min: 20, max: 500 });
    assertNumber('terminal:resize', 'rows', input.rows, { integer: true, min: 4, max: 200 });
    resizeSession(input.sessionId, input.cols, input.rows);
  });

  wrapIpcHandler(
    IPC.TERMINAL_RESTART,
    async (_event, input: TerminalRestartInput): Promise<TerminalCreateResult> => {
      assertObject('terminal:restart', 'input', input);
      assertString('terminal:restart', 'sessionId', input.sessionId);
      const session = restartSession(input.sessionId);
      if (!session) {
        const meta = getSessionMeta(input.sessionId);
        if (!meta) throw new Error('Unknown terminal session');
        return { ok: true, session: meta };
      }
      return { ok: true, session };
    }
  );

  /** Closing the terminal panel detaches the renderer only — PTYs stay alive for agent bash reuse. */
  wrapIpcHandler(IPC.TERMINAL_DETACH, async (_event, workspaceId?: string) => {
    assertOptionalString('terminal:detach', 'workspaceId', workspaceId);
    void workspaceId;
  });
}

export function teardownTerminalIpc(): void {
  disposeAllPtySessions();
}
