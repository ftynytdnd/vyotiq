/**
 * Shared JSON parsing for streaming tool-call `argumentsBuf` strings.
 */

import { logger } from '../../logging/logger.js';
import { tryRepairTruncatedToolArgsRecord } from './repairToolArgsJson.js';

const log = logger.child('orchestrator/parseToolArgs');

export interface ToolArgsParseResult {
  args: Record<string, unknown>;
  parseError?: string;
  /** True when a truncated streaming buffer was repaired before parse. */
  repaired?: boolean;
}

export interface ParseToolArgsOpts {
  /** When false, suppresses warn logs for probe parses (default true). */
  log?: boolean;
}

/**
 * Lenient parse — never throws. Malformed or non-object JSON becomes `{}`.
 * Empty buffer is treated as `{}` (same as `JSON.parse('{}')`).
 */
export function tryParseArgumentsRecord(buf: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf || '{}');
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

/**
 * Strict parse for tool dispatch. Surfaces `parseError` on malformed JSON
 * or a non-object shape so callers can short-circuit with a synthetic
 * failure instead of running tools with `{}`.
 */
export function parseToolArgs(
  name: string,
  buf: string,
  opts?: ParseToolArgsOpts
): ToolArgsParseResult {
  if (!buf) return { args: {} };
  const shouldLog = opts?.log !== false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const repaired = tryRepairTruncatedToolArgsRecord(buf);
    if (repaired) {
      if (shouldLog) {
        log.warn('tool arguments JSON repaired after truncation', {
          tool: name,
          buf: buf.slice(0, 200)
        });
      }
      return { args: repaired, repaired: true };
    }
    if (shouldLog) {
      log.warn('tool arguments failed to JSON.parse', {
        tool: name,
        buf: buf.slice(0, 200),
        err: detail
      });
    }
    return {
      args: {},
      parseError:
        `Tool argument JSON failed to parse: ${detail}. ` +
        'Re-issue the call with a well-formed JSON object for `arguments`.'
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const shape = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    if (shouldLog) {
      log.warn('tool arguments parsed to non-record', {
        tool: name,
        buf: buf.slice(0, 200),
        shape
      });
    }
    return {
      args: {},
      parseError:
        `Tool argument must be a JSON object, got ${shape}. ` +
        'Re-issue the call with a `{ "key": "value", … }` shape.'
    };
  }
  return { args: parsed as Record<string, unknown> };
}

/** Read one trimmed string field from a tool-call arguments buffer. */
export function parseStringArgFromBuf(argumentsBuf: string, field: string): string {
  const v = tryParseArgumentsRecord(argumentsBuf)[field];
  return typeof v === 'string' ? v.trim() : '';
}
