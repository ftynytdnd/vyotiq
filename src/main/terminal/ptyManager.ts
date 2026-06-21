/**
 * Per-workspace PTY sessions — supports multiple user terminals plus the
 * agent `bash` bridge.
 *
 * Each workspace has one **primary** session (the first one created) that
 * the agent `bash` tool shares; additional sessions are user-only. All
 * sessions are keyed globally by `sessionId`.
 */

import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import type { TerminalSessionMeta } from '@shared/types/terminal.js';
import {
  PTY_CMD_END_PREFIX,
  PTY_CMD_START,
  PTY_MAX_CAPTURE_CHARS,
  parsePtyAgentCompletion
} from '@shared/terminal/ptyMarkers.js';
import { buildBashEnv, shellSpawnSpec } from './bashEnv.js';
import { logger } from '../logging/logger.js';

const log = logger.child('terminal/pty');

interface PtySession {
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  shell: string;
  proc: IPty;
  cols: number;
  rows: number;
  /** Primary sessions back the agent `bash` shared shell. */
  primary: boolean;
  agentBusy: boolean;
  agentWaiters: Array<() => void>;
  /**
   * When true, the next agent injection sends Ctrl+C first to recover
   * from a prior timed-out / aborted run. Never set on clean success —
   * avoids interrupting the user's foreground job on a shared PTY.
   */
  agentInterruptPending: boolean;
  /** Per-capture handlers for concurrent agent bash in the same session. */
  agentCaptureHandlers: Set<(data: string) => void>;
}

const sessions = new Map<string, PtySession>();

interface PtyDataEvent {
  workspaceId: string;
  sessionId: string;
  data: string;
}
interface PtyExitEvent {
  workspaceId: string;
  sessionId: string;
  exitCode: number;
  signal?: number;
}

type DataListener = (event: PtyDataEvent) => void;
type ExitListener = (event: PtyExitEvent) => void;

let onData: DataListener | null = null;
let onExit: ExitListener | null = null;

export function setPtyEventHandlers(handlers: {
  onData: DataListener;
  onExit: ExitListener;
}): void {
  onData = handlers.onData;
  onExit = handlers.onExit;
}

function emitData(event: PtyDataEvent): void {
  onData?.(event);
  const session = sessions.get(event.sessionId);
  if (session) {
    for (const handler of session.agentCaptureHandlers) {
      handler(event.data);
    }
  }
}

function emitExit(event: PtyExitEvent): void {
  onExit?.(event);
}

function toMeta(session: PtySession): TerminalSessionMeta {
  return {
    sessionId: session.sessionId,
    workspaceId: session.workspaceId,
    shell: session.shell,
    cols: session.cols,
    rows: session.rows,
    primary: session.primary
  };
}

function escapePsSingle(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeBashSingle(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function buildWindowsAgentScript(command: string): string {
  const escaped = escapePsSingle(command);
  return (
    `$env:VYOTIQ_AGENT_CMD = '${escaped}'; ` +
    `Write-Output '${PTY_CMD_START}'; ` +
    `Invoke-Expression $env:VYOTIQ_AGENT_CMD; ` +
    `$vyotiqEc = $LASTEXITCODE; ` +
    `Write-Output ('${PTY_CMD_END_PREFIX}' + $vyotiqEc); ` +
    `Remove-Item Env:VYOTIQ_AGENT_CMD; ` +
    `exit $vyotiqEc`
  );
}

function wrapAgentCommand(command: string): string {
  if (process.platform === 'win32') {
    // Evaluate in the current PTY shell (already PowerShell). Nesting another
    // `powershell -EncodedCommand` child adds startup latency and can yield
    // empty captures until the child exits on slow recursive listings.
    const encoded = Buffer.from(buildWindowsAgentScript(command), 'utf16le').toString('base64');
    return (
      `$__vyotiqSb = [ScriptBlock]::Create(` +
      `[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'))); ` +
      `& $__vyotiqSb; Remove-Variable __vyotiqSb`
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
  const { workspaceId, sessionId, proc } = session;
  proc.onData((data) => {
    emitData({ workspaceId, sessionId, data });
  });
  proc.onExit(({ exitCode, signal }) => {
    sessions.delete(sessionId);
    emitExit({ workspaceId, sessionId, exitCode, ...(signal !== undefined ? { signal } : {}) });
    log.info('pty exited', { workspaceId, sessionId, exitCode, signal });
  });
}

function spawnSession(
  workspaceId: string,
  workspacePath: string,
  primary: boolean
): PtySession {
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
    sessionId: randomUUID(),
    workspaceId,
    workspacePath,
    shell,
    proc,
    cols,
    rows,
    primary,
    agentBusy: false,
    agentWaiters: [],
    agentInterruptPending: false,
    agentCaptureHandlers: new Set()
  };
  attachProcHandlers(session);
  sessions.set(session.sessionId, session);
  log.info('pty spawned', { workspaceId, sessionId: session.sessionId, shell, primary, cwd: workspacePath });
  return session;
}

function primarySessionFor(workspaceId: string): PtySession | undefined {
  for (const session of sessions.values()) {
    if (session.workspaceId === workspaceId && session.primary) return session;
  }
  return undefined;
}

/** Kill every PTY session for a workspace (e.g. on workspace remove). */
export function killWorkspacePty(workspaceId: string): void {
  for (const session of [...sessions.values()]) {
    if (session.workspaceId === workspaceId) killSession(session.sessionId);
  }
}

/** Ensure the workspace primary session exists and return it. */
export function ensureWorkspacePty(
  workspaceId: string,
  workspacePath: string
): TerminalSessionMeta {
  const existing = primarySessionFor(workspaceId);
  if (existing) {
    if (existing.workspacePath === workspacePath) return toMeta(existing);
    // Workspace path changed (moved/remounted) — recycle every session.
    killWorkspacePty(workspaceId);
  }
  return toMeta(spawnSession(workspaceId, workspacePath, true));
}

/** Spawn an additional, non-primary user session for a workspace. */
export function createWorkspaceSession(
  workspaceId: string,
  workspacePath: string
): TerminalSessionMeta {
  // Ensure the primary exists first so the agent bridge always has a home.
  if (!primarySessionFor(workspaceId)) {
    spawnSession(workspaceId, workspacePath, true);
  }
  return toMeta(spawnSession(workspaceId, workspacePath, false));
}

export function listWorkspaceSessions(workspaceId: string): TerminalSessionMeta[] {
  const list: TerminalSessionMeta[] = [];
  for (const session of sessions.values()) {
    if (session.workspaceId === workspaceId) list.push(toMeta(session));
  }
  // Primary first, then creation order (Map preserves insertion order).
  list.sort((a, b) => (a.primary === b.primary ? 0 : a.primary ? -1 : 1));
  return list;
}

export function getSessionMeta(sessionId: string): TerminalSessionMeta | null {
  const session = sessions.get(sessionId);
  return session ? toMeta(session) : null;
}

export function writeSession(sessionId: string, data: string): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown terminal session: ${sessionId}`);
  session.proc.write(data);
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown terminal session: ${sessionId}`);
  session.cols = cols;
  session.rows = rows;
  try {
    session.proc.resize(cols, rows);
  } catch (err) {
    log.debug('pty resize failed', {
      sessionId,
      err: err instanceof Error ? err.message : String(err)
    });
  }
}

export function killSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    session.proc.kill();
  } catch {
    /* noop */
  }
  sessions.delete(sessionId);
}

/** Restart a session in place; preserves its primary flag + workspace. */
export function restartSession(sessionId: string): TerminalSessionMeta | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  const { workspaceId, workspacePath, primary } = session;
  killSession(sessionId);
  return toMeta(spawnSession(workspaceId, workspacePath, primary));
}

export function disposeAllPtySessions(): void {
  for (const id of [...sessions.keys()]) {
    killSession(id);
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
  signal?: AbortSignal,
  onLiveChunk?: (data: string) => void
): Promise<AgentPtyRunResult | null> {
  const session = primarySessionFor(workspaceId);
  if (!session) return null;

  await acquireAgentLock(session);

  let buffer = '';
  let truncated = false;
  let settled = false;
  let exitCode = 1;
  let timedOut = false;

  const onChunk = (data: string) => {
    if (settled) return;
    onLiveChunk?.(data);
    if (buffer.length < PTY_MAX_CAPTURE_CHARS) {
      const room = PTY_MAX_CAPTURE_CHARS - buffer.length;
      buffer += data.length > room ? data.slice(0, room) : data;
      if (data.length > room) truncated = true;
    } else {
      truncated = true;
    }

    const completion = parsePtyAgentCompletion(buffer);
    if (completion.settled) {
      exitCode = completion.exitCode;
      settled = true;
      session.agentInterruptPending = false;
    }
  };

  session.agentCaptureHandlers.add(onChunk);

  const wrapped = wrapAgentCommand(command);
  if (session.agentInterruptPending) {
    try {
      session.proc.write('\x03');
    } catch {
      /* noop — recover shell after a prior timed-out / aborted run */
    }
    session.agentInterruptPending = false;
  }
  session.proc.write(`${wrapped}\r\n`);

  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        settled = true;
        session.agentInterruptPending = true;
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
        session.agentInterruptPending = true;
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
    session.agentCaptureHandlers.delete(onChunk);
    releaseAgentLock(session);
  }

  const completion = parsePtyAgentCompletion(buffer);
  return {
    output: completion.output.trimEnd(),
    exitCode: Number.isFinite(completion.settled ? completion.exitCode : exitCode)
      ? completion.settled
        ? completion.exitCode
        : exitCode
      : 1,
    timedOut,
    truncated
  };
}

/** Test-only: inspect agent command wrapping for the shared PTY path. */
export const __test_wrapAgentCommand = wrapAgentCommand;
