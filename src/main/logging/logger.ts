/**
 * Centralized structured logger for the main process.
 *
 * - Leveled methods: debug | info | warn | error.
 * - Console output: `[ts] LEVEL scope message {json}`.
 * - Rolling file at <userData>/vyotiq/logs/vyotiq.log:
 *     - 1 MB per file
 *     - last-3 retention (.log → .log.1 → .log.2; .log.3 deleted)
 * - `child(scope)` for per-module sub-loggers.
 * - Process-level unhandledRejection / uncaughtException hooks → error level.
 *   The hooks NEVER rethrow; the process keeps running.
 *
 * Single source of truth — replaces ad-hoc `console.warn` / `console.error`.
 */

import { join } from 'node:path';
import { logsDir } from '../paths/userDataLayout.js';
import { promises as fs, existsSync, statSync } from 'node:fs';
import type { LogLevel, Logger } from '@shared/types/logger.js';
import { abortAllActiveRunsWithError } from '../orchestrator/runCrashDrain.js';

interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  msg: string;
  fields?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const MAX_BYTES = 1 * 1024 * 1024;
const MAX_BACKUPS = 3; // keeps .log.1, .log.2, .log.3
const LOG_FILE_NAME = 'vyotiq.log';
const MIN_LEVEL: LogLevel = (process.env['VYOTIQ_LOG_LEVEL'] as LogLevel | undefined) ?? 'info';

let logDir: string | null = null;
let logFile: string | null = null;

/** A FIFO write queue ensures rotation never races with appends. */
let writeChain: Promise<void> = Promise.resolve();

function resolvePaths(): { dir: string; file: string } {
  if (!logDir || !logFile) {
    logDir = logsDir();
    logFile = join(logDir, LOG_FILE_NAME);
  }
  return { dir: logDir, file: logFile };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function fileSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

async function rotateIfNeeded(file: string): Promise<void> {
  if (!existsSync(file)) return;
  if (fileSize(file) < MAX_BYTES) return;

  // .log.N → .log.(N+1), oldest discarded
  for (let i = MAX_BACKUPS; i >= 1; i--) {
    const src = `${file}.${i}`;
    const dst = `${file}.${i + 1}`;
    if (existsSync(src)) {
      if (i === MAX_BACKUPS) {
        try { await fs.unlink(src); } catch { /* noop */ }
      } else {
        try { await fs.rename(src, dst); } catch { /* noop */ }
      }
    }
  }
  try {
    await fs.rename(file, `${file}.1`);
  } catch {
    // If rename fails (file locked on Windows), truncate to keep going.
    try { await fs.writeFile(file, ''); } catch { /* noop */ }
  }
}

async function appendToFile(line: string): Promise<void> {
  const { dir, file } = resolvePaths();
  try {
    await ensureDir(dir);
    await rotateIfNeeded(file);
    await fs.appendFile(file, line + '\n', 'utf8');
  } catch {
    // Logger MUST never crash the process. Fail silently.
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function formatConsoleLine(text: string): string {
  // Windows terminals often decode UTF-8 log bytes as cp1252, turning em dashes into mojibake.
  if (process.platform === 'win32') {
    return text.replace(/\u2014/g, ' - ');
  }
  return text;
}

function consoleSink(entry: LogEntry): void {
  const head = `[${entry.ts}] ${entry.level.toUpperCase().padEnd(5)} ${entry.scope}`;
  const tail = entry.fields && Object.keys(entry.fields).length > 0 ? ' ' + safeStringify(entry.fields) : '';
  const text = formatConsoleLine(`${head} ${entry.msg}${tail}`);
  switch (entry.level) {
    case 'debug':
    case 'info':
      // eslint-disable-next-line no-console
      console.log(text);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(text);
      break;
    case 'error':
      // eslint-disable-next-line no-console
      console.error(text);
      break;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, replaceCircular());
  } catch {
    return '"[unserializable]"';
  }
}

/** Replacer that handles circular refs and Errors. */
function replaceCircular() {
  const seen = new WeakSet<object>();
  return (_key: string, val: unknown) => {
    if (val instanceof Error) {
      return { name: val.name, message: val.message, stack: val.stack };
    }
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val as object)) return '[Circular]';
      seen.add(val as object);
    }
    return val;
  };
}

function emit(level: LogLevel, scope: string, msg: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(fields ? { fields } : {})
  };
  consoleSink(entry);
  // Serialize disk writes — never await from caller.
  const line = safeStringify(entry);
  writeChain = writeChain.then(() => appendToFile(line)).catch(() => undefined);
}

function makeLogger(scope: string): Logger {
  return {
    debug: (msg, fields) => emit('debug', scope, msg, fields),
    info: (msg, fields) => emit('info', scope, msg, fields),
    warn: (msg, fields) => emit('warn', scope, msg, fields),
    error: (msg, fields) => emit('error', scope, msg, fields),
    child: (sub: string) => makeLogger(`${scope}/${sub}`)
  };
}

export const logger: Logger = makeLogger('vyotiq');

/** Await pending log file writes — call from `before-quit` for shutdown breadcrumbs. */
export async function drainLogger(): Promise<void> {
  await writeChain;
}

/**
 * Install process-level handlers ONCE at boot. Uncaught errors are logged
 * but never crash the app — Agent V is an always-on desktop agent.
 */
let installed = false;
const CRASH_USER_MESSAGE =
  'An unexpected error interrupted the run. Check the log for details.';

function drainProcessCrash(label: string, detail: unknown): void {
  logger.error(label, {
    ...(label === 'unhandledRejection'
      ? { reason: serializeError(detail) }
      : { error: serializeError(detail) })
  });
  abortAllActiveRunsWithError(CRASH_USER_MESSAGE);
}

export function installCrashHandlers(): void {
  if (installed) return;
  installed = true;
  process.on('unhandledRejection', (reason) => {
    drainProcessCrash('unhandledRejection', reason);
  });
  process.on('uncaughtException', (err) => {
    drainProcessCrash('uncaughtException', err);
  });
}

function serializeError(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}
