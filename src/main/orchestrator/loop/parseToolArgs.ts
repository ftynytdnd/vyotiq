/**
 * Shared JSON parsing for streaming tool-call `argumentsBuf` strings.
 */

import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/parseToolArgs');

export interface ToolArgsParseResult {
  args: Record<string, unknown>;
  parseError?: string;
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
 * Lenient parse preserving top-level arrays (delegate argument batches).
 */
export function tryParseArgumentsUnknown(buf: string): unknown {
  try {
    return JSON.parse(buf || '{}');
  } catch {
    return {};
  }
}

/**
 * Strict parse for tool dispatch. Surfaces `parseError` on malformed JSON
 * or a non-object shape so callers can short-circuit with a synthetic
 * failure instead of running tools with `{}`.
 */
export function parseToolArgs(name: string, buf: string): ToolArgsParseResult {
  if (!buf) return { args: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    log.warn('tool arguments failed to JSON.parse', {
      tool: name,
      buf: buf.slice(0, 200),
      err: detail
    });
    return {
      args: {},
      parseError:
        `Tool argument JSON failed to parse: ${detail}. ` +
        'Re-issue the call with a well-formed JSON object for `arguments`.'
    };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const shape = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    log.warn('tool arguments parsed to non-record', {
      tool: name,
      buf: buf.slice(0, 200),
      shape
    });
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
