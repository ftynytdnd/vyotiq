/**
 * Per-workspace shared PTY sessions — user terminal + agent bash bridge.
 */

import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import {
  PTY_CMD_END_PREFIX,
  PTY_CMD_START,
  PTY_MAX_CAPTURE_CHARS
} from '@shared/terminal/ptyMarkers.js';
import { buildBashEnv, shellSpawnSpec } from './bashEnv.js';
import { logger } from '../logging/logger.js';

const log = logger.child('terminal/pty');

interface PtySession {
  workspaceId: string;
  workspacePath: string;
  proc: IPty;
  cols: number;
  rows: number;
  agentBusy: boolean;
  agentWaiters: Array<() => void>;
}

const sessions = new Map<string, PtySession>();

type DataListener = (workspaceId: string, data: string) => void;
type ExitListener = (workspaceId: string, exitCode: number, signal?: number) => void;

let onData: DataListener | null = null;
let onExit: ExitListener | null = null;

export function setPtyEventHandlers(handlers: {
  onData: DataListener;
  onExit: ExitListener;
}): void {
  onData = handlers.onData;
  onExit = handlers.onExit;
}

function emitData(workspaceId: string, data: string): void {
  onData?.(workspaceId, data);
}

function emitExit(workspaceId: string, exitCode: number, signal?: number): void {
  onExit?.(workspaceId, exitCode, signal);
}

function escapePsSingle(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeBashSingle(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function wrapAgentCommand(command: string): string {
  if (process.platform === 'win32') {
    const escaped = escapePsSingle(command);
    return (
      `$env:VYOTIQ_AGENT_CMD = '${escaped}'; ` +
      `Write-Output '${PTY_CMD_START}'; ` +
      `Invoke-Expression $env:VYOTIQ_AGENT_CMD; ` +
      `Write-Output ('${PTY_CMD_END_PREFIX}' + $LASTEXITCODE); ` +
      `Remove-Item Env:VYOTIQ_AGENT_CMD`
    );
  }
  const escaped = escapeBashSingle(command);
  return (
    `export VYOTIQ_AGENT_CMD='${escaped}'; ` +
    `echo ${PTY_CMD_START}; ` +
    `eval "$VYOTIQ_AGENT_CMD"; ` +
    `echo ${PTY_CMD_END_PREFIX}$?; ` +
    `unset VYOTIQ_AGENT_CMD`
  );
}

function attachProcHandlers(session: PtySession): void {
  const { workspaceId, proc } = session;
  proc.onData((data) => {
    emitData(workspaceId, data);
  });
  proc.onExit(({ exitCode, signal }) => {
    sessions.delete(workspaceId);
    emitExit(workspaceId, exitCode, signal);
    log.info('pty exited', { workspaceId, exitCode, signal });
  });
}

function createSession(workspaceId: string, workspacePath: string): PtySession {
  const { shell, args } = shellSpawnSpec();
  const cols = 120;
  const rows = 32;
  const env = buildBashEnv() as Record<string, string>;
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';

  const proc = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: workspacePath,
    env
  });

  const session: PtySession = {
    workspaceId,
    workspacePath,
    proc,
    cols,
    rows,
    agentBusy: false,
    agentWaiters: []
  };
  attachProcHandlers(session);
  sessions.set(workspaceId, session);
  log.info('pty spawned', { workspaceId, shell, cwd: workspacePath });
  return session;
}

export function hasWorkspacePty(workspaceId: string): boolean {
  return sessions.has(workspaceId);
}

export function ensureWorkspacePty(
  workspaceId: string,
  workspacePath: string
): { shell: string; cols: number; rows: number } {
  let session = sessions.get(workspaceId);
  if (!session) {
    session = createSession(workspaceId, workspacePath);
  } else if (session.workspacePath !== workspacePath) {
    killWorkspacePty(workspaceId);
    session = createSession(workspaceId, workspacePath);
  }
  const { shell } = shellSpawnSpec();
  return { shell, cols: session.cols, rows: session.rows };
}

export function writeWorkspacePty(workspaceId: string, data: string): void {
  const session = sessions.get(workspaceId);
  if (!session) return;
  session.proc.write(data);
}

export function resizeWorkspacePty(workspaceId: string, cols: number, rows: number): void {
  const session = sessions.get(workspaceId);
  if (!session) return;
  session.cols = cols;
  session.rows = rows;
  try {
    session.proc.resize(cols, rows);
  } catch (err) {
    log.debug('pty resize failed', {
      workspaceId,
      err: err instanceof Error ? err.message : String(err)
    });
  }
}

export function killWorkspacePty(workspaceId: string): void {
  const session = sessions.get(workspaceId);
  if (!session) return;
  try {
    session.proc.kill();
  } catch {
    /* noop */
  }
  sessions.delete(workspaceId);
}

export function disposeAllPtySessions(): void {
  for (const id of [...sessions.keys()]) {
    killWorkspacePty(id);
  }
}

async function acquireAgentLock(session: PtySession): Promise<void> {
  if (!session.agentBusy) {
    session.agentBusy = true;
    return;
  }
    await new Promise<void>((resolve) => {
      session.agentWaiters.push(() => {
        resolve();
      });
    });
  session.agentBusy = true;
}

function releaseAgentLock(session: PtySession): void {
  session.agentBusy = false;
  const next = session.agentWaiters.shift();
  if (next) next();
}

export interface AgentPtyRunResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
}

export async function runAgentCommandInPty(
  workspaceId: string,
  command: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<AgentPtyRunResult | null> {
  const session = sessions.get(workspaceId);
  if (!session) return null;

  await acquireAgentLock(session);

  let buffer = '';
  let truncated = false;
  let settled = false;
  let exitCode = 1;
  let timedOut = false;

  const onChunk = (data: string) => {
    if (settled) return;
    if (buffer.length < PTY_MAX_CAPTURE_CHARS) {
      const room = PTY_MAX_CAPTURE_CHARS - buffer.length;
      buffer += data.length > room ? data.slice(0, room) : data;
      if (data.length > room) truncated = true;
    } else {
      truncated = true;
    }

    const endIdx = buffer.lastIndexOf(PTY_CMD_END_PREFIX);
    if (endIdx >= 0) {
      const tail = buffer.slice(endIdx + PTY_CMD_END_PREFIX.length);
      const codeMatch = /^(-?\d+)/.exec(tail);
      if (codeMatch) {
        exitCode = Number.parseInt(codeMatch[1] ?? '1', 10);
        settled = true;
      }
    }
  };

  const dataHandler = (id: string, data: string) => {
    if (id !== workspaceId) return;
    onChunk(data);
  };

  const prevOnData = onData;
  onData = (id, data) => {
    dataHandler(id, data);
    prevOnData?.(id, data);
  };

  const wrapped = wrapAgentCommand(command);
  session.proc.write(`${wrapped}\r\n`);

  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        settled = true;
        try {
          session.proc.write('\x03');
        } catch {
          /* noop */
        }
        resolve();
      }, timeoutMs);

      const abort = () => {
        timedOut = true;
        settled = true;
        try {
          session.proc.write('\x03');
        } catch {
          /* noop */
        }
        resolve();
      };
      signal?.addEventListener('abort', abort, { once: true });

      const poll = () => {
        if (settled) {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          resolve();
          return;
        }
        setTimeout(poll, 25);
      };
      poll();
    });
  } finally {
    onData = prevOnData;
    releaseAgentLock(session);
  }

  const startIdx = buffer.indexOf(PTY_CMD_START);
  const endIdx = buffer.lastIndexOf(PTY_CMD_END_PREFIX);
  let output = buffer;
  if (startIdx >= 0 && endIdx > startIdx) {
    output = buffer.slice(startIdx + PTY_CMD_START.length, endIdx);
  } else if (startIdx >= 0) {
    output = buffer.slice(startIdx + PTY_CMD_START.length);
  }

  return {
    output: output.trimEnd(),
    exitCode: Number.isFinite(exitCode) ? exitCode : 1,
    timedOut,
    truncated
  };
}
