/**
 * Pre-dispatch argument validation for registered tools.
 *
 * Fails fast before `toolRunner` (and dedupe counters) so repeated
 * malformed calls surface the real validation error instead of
 * `duplicate_tool_call` on the third identical attempt.
 *
 * Prose-emitted tool JSON is not recovered here — only native `tool_calls`
 * from the provider stream are dispatched by the orchestrator loop.
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
      const query = args['query'];
      const pattern = args['pattern'];
      const kind = args['kind'];
      const hasQuery = typeof query === 'string' && query.trim().length > 0;
      const hasPattern = typeof pattern === 'string' && pattern.trim().length > 0;
      const hasKind = typeof kind === 'string' && kind.trim().length > 0;
      if (!hasQuery && !hasPattern && !hasKind) {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'query|pattern|kind',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: provide `query`, `pattern`, or `kind`.',
          error: 'missing query'
        };
      }
      return { ok: true };
    }
    case 'sg': {
      const action = args['action'];
      if (action !== 'run' && action !== 'scan' && action !== 'test') {
        return {
          ok: false,
          output: 'Error: `action` must be "run", "scan", or "test".',
          error: 'invalid action'
        };
      }
      if (action === 'run' && !requireNonEmptyString(args, 'pattern')) {
        return {
          ok: false,
          output: 'Error: `pattern` is required for sg run.',
          error: 'missing pattern'
        };
      }
      if (action === 'scan') {
        const rulePath = requireNonEmptyString(args, 'rulePath');
        const configPath = requireNonEmptyString(args, 'configPath');
        if (!rulePath && !configPath) {
          return {
            ok: false,
            output: 'Error: provide `rulePath` or `configPath` for sg scan.',
            error: 'missing rulePath or configPath'
          };
        }
      }
      if (action === 'test') {
        return { ok: true };
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
    case 'capture': {
      const target = args['target'];
      if (target !== 'browser' && target !== 'screen' && target !== 'window') {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'target',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `target` must be browser, screen, or window.',
          error: 'invalid target'
        };
      }
      if (target === 'screen' && !requireNonEmptyString(args, 'sourceId')) {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'sourceId',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `sourceId` is required when target is screen.',
          error: 'missing sourceId'
        };
      }
      return { ok: true };
    }
    case 'report': {
      if (!requireNonEmptyString(args, 'title')) {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'title',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `title` is required.',
          error: 'missing title'
        };
      }
      const body = args['body'];
      if (typeof body !== 'string' || body.length === 0) {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'body',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `body` is required.',
          error: 'missing body'
        };
      }
      return { ok: true };
    }
    case 'recall': {
      const action = args['action'];
      if (action !== 'list' && action !== 'read') {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'action',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `action` must be "list" or "read".',
          error: 'invalid action'
        };
      }
      if (action === 'read' && !requireNonEmptyString(args, 'conversationId')) {
        log.warn('required tool argument missing', {
          tool: toolName,
          field: 'conversationId',
          argKeys: Object.keys(args)
        });
        return {
          ok: false,
          output: 'Error: `conversationId` is required for action="read".',
          error: 'missing conversationId'
        };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}
