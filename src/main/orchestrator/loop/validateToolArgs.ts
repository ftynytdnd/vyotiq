/**
 * Pre-dispatch argument validation for registered tools.
 *
 * Fails fast before `toolRunner` (and dedupe counters) so repeated
 * malformed calls surface the real validation error instead of
 * `duplicate_tool_call` on the third identical attempt.
 */

import { logger } from '../../logging/logger.js';

const log = logger.child('orchestrator/validateToolArgs');

export type ToolArgsValidationResult =
  | { ok: true }
  | { ok: false; output: string; error: string };

function requireNonEmptyString(
  args: Record<string, unknown>,
  field: string
): string | null {
  const v = args[field];
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim();
}

/**
 * Validate parsed tool arguments before dispatch. Messages mirror the
 * corresponding tool implementations so the model sees consistent copy.
 */
export function validateToolArgs(
  toolName: string,
  args: Record<string, unknown>
): ToolArgsValidationResult {
  switch (toolName) {
    case 'read':
    case 'edit':
    case 'delete': {
      if (!requireNonEmptyString(args, 'path')) {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'path',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `path` is required.',
          error: 'missing path'
        };
      }
      return { ok: true };
    }
    case 'bash': {
      if (!requireNonEmptyString(args, 'command')) {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'command',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `command` is required.',
          error: 'missing command'
        };
      }
      return { ok: true };
    }
    case 'search': {
      if (!requireNonEmptyString(args, 'query')) {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'query',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `query` is required.',
          error: 'missing query'
        };
      }
      const mode = args['mode'];
      if (mode !== 'local' && mode !== 'structural') {
        log.warn('invalid tool argument value', {
          tool: toolName,
          field: 'mode',
          value: mode,
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: `Error: unknown search mode "${String(mode)}" — use "local" or "structural". Web search is not available.`,
          error: 'invalid mode'
        };
      }
      if (mode === 'structural') {
        const language = args['language'];
        if (typeof language !== 'string' || !language.trim()) {
          log.warn('required tool argument missing', {
            tool: toolName,
            field: 'language',
            argKeys: Object.keys(args)
          });
          return {
            ok: false,
            output:
              'Error: structural search requires `language` (e.g. typescript, javascript, tsx).',
            error: 'missing language'
          };
        }
      }
      return { ok: true };
    }
    case 'memory': {
      const action = args['action'];
      const scope = args['scope'];
      if (
        typeof action !== 'string' ||
        !action.trim() ||
        typeof scope !== 'string' ||
        !scope.trim()
      ) {
        log.warn('required tool arguments missing', {
          tool: toolName,
          fields: ['action', 'scope'],
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `action` and `scope` are required.',
          error: 'invalid args'
        };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}
