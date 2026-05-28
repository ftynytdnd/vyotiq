/**
 * Bounded `git -C <workspace> …` helper for checkpoint review features.
 * Read-only callers; enforces a hard timeout so a stuck git cannot block main.
 */

import { spawn, type ChildProcess } from 'node:child_process';

const GIT_COMMAND_TIMEOUT_MS = 30_000;

export interface RunGitResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface RunGitOptions {
  timeoutMs?: number;
  /** When set, stdout collection stops after this many bytes (diff patches). */
  maxStdoutBytes?: number;
}

function killGitChild(child: ChildProcess): void {
  try {
    child.kill('SIGTERM');
  } catch {
    /* noop */
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* noop */
    }
  }, 1_000).unref?.();
}

export function runGit(
  workspacePath: string,
  args: string[],
  opts?: RunGitOptions
): Promise<RunGitResult> {
  const timeoutMs = opts?.timeoutMs ?? GIT_COMMAND_TIMEOUT_MS;
  const maxStdoutBytes = opts?.maxStdoutBytes;

  return new Promise((resolve) => {
    const child = spawn('git', ['-C', workspacePath, ...args], { windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let stdoutSize = 0;
    let settled = false;

    const finish = (result: RunGitResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      killGitChild(child);
      finish({
        code: -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: `git command timed out after ${timeoutMs}ms`,
        timedOut: true
      });
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (buf: Buffer) => {
      if (maxStdoutBytes === undefined) {
        out.push(buf);
        return;
      }
      const remaining = maxStdoutBytes - stdoutSize;
      if (remaining <= 0) return;
      const slice = buf.length > remaining ? buf.subarray(0, remaining) : buf;
      stdoutSize += slice.length;
      out.push(slice);
    });
    child.stderr.on('data', (buf: Buffer) => err.push(buf));
    child.on('error', (e) => {
      finish({ code: -1, stdout: '', stderr: String(e) });
    });
    child.on('close', (code) => {
      finish({
        code: code ?? -1,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8')
      });
    });
  });
}
