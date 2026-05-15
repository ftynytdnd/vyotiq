/**
 * Renderer-side structured logger.
 *
 * Mirrors the main-process `logger.ts` shape (`debug | info | warn | error`
 * + `child(scope)`) so log call-sites read the same on both processes. The
 * renderer cannot write to userData files; sink is `console` only. Setting
 * `window.__VYOTIQ_LOG_LEVEL` to `'debug'` unlocks debug output for in-app
 * triage without requiring a rebuild.
 */

import type { LogLevel, Logger } from '@shared/types/logger.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

interface LogGlobals {
  __VYOTIQ_LOG_LEVEL?: LogLevel;
}

function minLevel(): LogLevel {
  const w = (typeof window !== 'undefined' ? window : globalThis) as unknown as LogGlobals;
  return w.__VYOTIQ_LOG_LEVEL ?? 'info';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel()];
}

function head(scope: string, level: LogLevel): string {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  return `[${ts}] ${level.toUpperCase().padEnd(5)} ${scope}`;
}

function emit(level: LogLevel, scope: string, msg: string, fields?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const text = `${head(scope, level)} ${msg}`;
  const args: unknown[] = fields && Object.keys(fields).length > 0 ? [text, fields] : [text];
  switch (level) {
    case 'debug':
    case 'info':
      // eslint-disable-next-line no-console
      console.log(...args);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(...args);
      break;
    case 'error':
      // eslint-disable-next-line no-console
      console.error(...args);
      break;
  }
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
