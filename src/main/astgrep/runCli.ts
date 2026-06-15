/**
 * Spawn the bundled ast-grep CLI with abort, timeout, and output caps.
 */

import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { resolveAstGrepBinaryPath } from './resolveBinary.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 64 * 1024;

export interface RunCliOpts {
  args: string[];
  cwd: string;
  signal: AbortSignal;
  timeoutMs?: number;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export function astGrepCliAvailable(): boolean {
  return resolveAstGrepBinaryPath() != null;
}

export async function runAstGrepCli(opts: RunCliOpts): Promise<RunCliResult> {
  const binary = resolveAstGrepBinaryPath();
  if (!binary) {
    throw new Error(
      'ast-grep CLI binary not found. Ensure @ast-grep/cli optional dependencies are installed.'
    );
  }

  if (opts.signal.aborted) {
    return {
      stdout: '',
      stderr: 'ast-grep aborted.',
      exitCode: null,
      signal: 'SIGTERM',
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false
    };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<RunCliResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(binary, opts.args, {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const outDec = new StringDecoder('utf8');
    const errDec = new StringDecoder('utf8');

    const append = (
      chunk: Buffer,
      target: 'stdout' | 'stderr'
    ): void => {
      const text = (target === 'stdout' ? outDec : errDec).write(chunk);
      if (!text) return;
      if (target === 'stdout') {
        if (stdout.length + text.length > MAX_OUTPUT_CHARS) {
          const room = Math.max(0, MAX_OUTPUT_CHARS - stdout.length);
          stdout += text.slice(0, room);
          stdoutTruncated = true;
        } else {
          stdout += text;
        }
      } else if (stderr.length + text.length > MAX_OUTPUT_CHARS) {
        const room = Math.max(0, MAX_OUTPUT_CHARS - stderr.length);
        stderr += text.slice(0, room);
        stderrTruncated = true;
      } else {
        stderr += text;
      }
    };

    const finish = (result: RunCliResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const killChild = (): void => {
      if (child.killed || child.exitCode != null) return;
      try {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        /* noop */
      }
    };

    const onAbort = (): void => {
      killChild();
      finish({
        stdout,
        stderr: stderr || 'ast-grep aborted.',
        exitCode: null,
        signal: 'SIGTERM',
        timedOut: false,
        stdoutTruncated,
        stderrTruncated
      });
    };

    opts.signal.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      killChild();
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => append(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => append(chunk, 'stderr'));

    child.on('error', (err) => {
      finish({
        stdout,
        stderr: stderr || err.message,
        exitCode: 1,
        signal: null,
        timedOut,
        stdoutTruncated,
        stderrTruncated
      });
    });

    child.on('close', (code, signal) => {
      const tailOut = outDec.end();
      const tailErr = errDec.end();
      if (tailOut) append(Buffer.from(tailOut), 'stdout');
      if (tailErr) append(Buffer.from(tailErr), 'stderr');
      finish({
        stdout,
        stderr,
        exitCode: code,
        signal,
        timedOut,
        stdoutTruncated,
        stderrTruncated
      });
    });
  });
}
