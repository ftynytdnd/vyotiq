/**
 * Detect and rewrite bash commands that start long-running servers.
 *
 * Foreground daemons (`ollama serve`, `Start-Process -NoNewWindow … serve`,
 * `npm run dev`, etc.) block the shared workspace PTY until they exit. The
 * agent wrapper never emits `__VYOTIQ_CMD_END__`, so the run appears stuck
 * on "Running command" for the full `timeoutMs` budget (up to 30 minutes).
 *
 * Safe server starts are rewritten to a detached launch plus a short health
 * probe. Unhandled dev-server patterns are blocked with actionable guidance.
 */

import { BASH_SERVER_START_TIMEOUT_MS } from '@shared/constants.js';

export interface BashLongRunningRewrite {
  kind: 'rewrite';
  /** Detached startup command — must exit on its own. */
  command: string;
  timeoutMs: number;
  /** Always bypass the shared PTY for server starts. */
  isolated: true;
  note: string;
}

export interface BashLongRunningBlocked {
  kind: 'block';
  output: string;
  error: string;
}

export type BashLongRunningResolution = BashLongRunningRewrite | BashLongRunningBlocked | null;

const OLLAMA_SERVE_RE = /\bollama(?:\.exe)?\s+serve\b/i;
const OLLAMA_START_PROCESS_RE = /Start-Process\b[\s\S]*\bollama(?:\.exe)?\b[\s\S]*\bserve\b/i;
const START_PROCESS_NO_NEW_WINDOW_RE = /Start-Process\b[\s\S]*-NoNewWindow\b/i;
const START_PROCESS_WAIT_SERVER_RE =
  /Start-Process\b[\s\S]*-Wait\b[\s\S]*\b(serve|listen)\b/i;
const SERVER_ARG_RE = /\b(serve|listen)\b/i;

/** Dev servers and foreground daemons we cannot safely auto-detach. */
const BLOCKING_SERVER_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve)\b/i,
  /\bpython(?:3)?\s+-m\s+http\.server\b/i,
  /\buvicorn\b/i,
  /\bflask\s+run\b/i,
  /\bdjango-admin\s+runserver\b/i,
  /\brails\s+server\b/i,
  /\bng\s+serve\b/i,
  /\bnext\s+dev\b/i,
  /\bflutter\s+run\b/i,
  /\bdocker\s+run\b(?![\s\S]*(?:\s|^)-d\b)(?![\s\S]*--detach)/i
];

function isOllamaServeCommand(command: string): boolean {
  return OLLAMA_SERVE_RE.test(command) || OLLAMA_START_PROCESS_RE.test(command);
}

function isStartProcessBlockingServer(command: string): boolean {
  if (!START_PROCESS_NO_NEW_WINDOW_RE.test(command)) return false;
  return SERVER_ARG_RE.test(command);
}

function windowsOllamaDetachedCommand(): string {
  return (
    "$p = Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden -PassThru; " +
    'Start-Sleep -Seconds 2; ' +
    "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 | Out-Null; Write-Output 'ollama: ready' } " +
    "catch { Write-Output ('ollama: started (pid ' + $p.Id + '); health check pending — probe http://127.0.0.1:11434/api/tags') }"
  );
}

function unixOllamaDetachedCommand(): string {
  return (
    'nohup ollama serve >/dev/null 2>&1 & disown; ' +
    'sleep 2; ' +
    "curl -sf http://127.0.0.1:11434/api/tags >/dev/null && echo 'ollama: ready' || echo 'ollama: started; health check pending'"
  );
}

function rewriteStartProcessNoNewWindow(command: string): string {
  let rewritten = command.replace(/-NoNewWindow\b/gi, '').replace(/\s+/g, ' ').trim();
  rewritten = rewritten.replace(/-Wait\b/gi, '').trim();
  if (!/-WindowStyle\b/i.test(rewritten)) {
    rewritten = rewritten.replace(/Start-Process\b/i, 'Start-Process -WindowStyle Hidden');
  }
  return rewritten;
}

function windowsDetachedProbeSuffix(ollama: boolean): string {
  if (ollama) {
    return (
      'Start-Sleep -Seconds 2; ' +
      "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 | Out-Null; Write-Output 'ollama: ready' } " +
      "catch { Write-Output 'ollama: started; health check pending' }"
    );
  }
  return 'Write-Output "process started detached"';
}

function buildBlockedMessage(command: string): string {
  return (
    'Bash blocked: this command starts a long-running server or dev process.\n\n' +
    `${command}\n\n` +
    'The `bash` tool waits for commands to finish and cannot host daemons — starting a server here blocks the agent for minutes.\n\n' +
    'Instead:\n' +
    '- Check whether the service is already running (e.g. `curl -sf http://127.0.0.1:PORT/...` on Unix, `Invoke-RestMethod` on Windows).\n' +
    '- Ask the user to start the service outside Vyotiq if it is not running.\n' +
    '- Do not raise `timeoutMs` to keep a server alive — use a quick health probe only.'
  );
}

function rewritePlan(command: string, note: string): BashLongRunningRewrite {
  return {
    kind: 'rewrite',
    command,
    timeoutMs: BASH_SERVER_START_TIMEOUT_MS,
    isolated: true,
    note
  };
}

/**
 * Classify a bash command for long-running server behavior.
 * Returns `null` when the command is an ordinary short-lived invocation.
 */
export function resolveBashLongRunning(command: string): BashLongRunningResolution {
  const trimmed = command.trim();
  if (!trimmed) return null;

  if (isOllamaServeCommand(trimmed)) {
    if (process.platform === 'win32') {
      if (isStartProcessBlockingServer(trimmed)) {
        const body = rewriteStartProcessNoNewWindow(trimmed);
        return rewritePlan(
          `${body}; ${windowsDetachedProbeSuffix(true)}`,
          'ollama Start-Process -NoNewWindow rewritten to detached startup'
        );
      }
      return rewritePlan(windowsOllamaDetachedCommand(), 'ollama serve rewritten to detached startup');
    }
    return rewritePlan(unixOllamaDetachedCommand(), 'ollama serve rewritten to detached startup');
  }

  if (process.platform === 'win32' && isStartProcessBlockingServer(trimmed)) {
    const body = rewriteStartProcessNoNewWindow(trimmed);
    const ollama = OLLAMA_START_PROCESS_RE.test(trimmed);
    return rewritePlan(
      `${body}; ${windowsDetachedProbeSuffix(ollama)}`,
      'Start-Process -NoNewWindow rewritten to detached startup'
    );
  }

  if (process.platform === 'win32' && START_PROCESS_WAIT_SERVER_RE.test(trimmed)) {
    const body = rewriteStartProcessNoNewWindow(trimmed);
    const ollama = OLLAMA_START_PROCESS_RE.test(trimmed);
    return rewritePlan(
      `${body}; ${windowsDetachedProbeSuffix(ollama)}`,
      'Start-Process -Wait server rewritten to detached startup'
    );
  }

  for (const pattern of BLOCKING_SERVER_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        kind: 'block',
        output: buildBlockedMessage(trimmed),
        error: 'long-running server'
      };
    }
  }

  return null;
}
