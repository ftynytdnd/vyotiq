/**
 * Shared logger surface used by both the main and renderer logger
 * implementations. The two processes have different sinks (main writes to
 * disk + console; renderer writes to console only), but the call-site
 * shape is identical so unifying the type avoids drift.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(scope: string): Logger;
}
