/**
 * Pre-dispatch argument validation for registered tools.
 *
 * Fails fast before `toolRunner` (and dedupe counters) so repeated
 * malformed calls surface the real validation error instead of
 * `duplicate_tool_call` on the repeat budget for identical (tool, args).
 *
 * Prose-emitted tool JSON is not recovered here — only native `tool_calls`
 * from the provider stream are dispatched by the orchestrator loop.
 */

import { TASK_CONTENT_MAX_CHARS, TASK_LIST_MAX_ITEMS } from '@shared/types/task.js';
import type { RegisteredToolName } from '@shared/types/tool.js';
import {
  HEARTBEAT_MAX_INTERVAL_MINUTES,
  HEARTBEAT_MIN_INTERVAL_MINUTES
} from '@shared/constants.js';
import { isKnownToolName } from '../../tools/registry.js';
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
  if (!isKnownToolName(toolName)) {
    return { ok: true };
  }
  return validateRegisteredToolArgs(toolName, args);
}

function validateRegisteredToolArgs(
  toolName: RegisteredToolName,
  args: Record<string, unknown>
): ToolArgsValidationResult {
  switch (toolName) {
    case 'read':
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
    case 'edit': {
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
      const create = args['create'] === true;
      if (create) {
        if (typeof args['content'] !== 'string' || args['content'].length === 0) {
          return {
            ok: false,
            output: 'Error: `content` is required when `create` is true.',
            error: 'missing content'
          };
        }
        return { ok: true };
      }
      if (!requireNonEmptyString(args, 'oldString')) {
        return {
          ok: false,
          output: 'Error: `oldString` is required for edits.',
          error: 'missing oldString'
        };
      }
      if (typeof args['newString'] !== 'string') {
        return {
          ok: false,
          output: 'Error: `newString` is required for edits.',
          error: 'missing newString'
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
      if (
        target !== 'browser' &&
        target !== 'screen' &&
        target !== 'window'
      ) {
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
    case 'context': {
      const action = args['action'];
      if (action !== 'list' && action !== 'load') {
        return {
          ok: false,
          output: 'Error: `action` must be "list" or "load".',
          error: 'invalid action'
        };
      }
      if (action === 'load') {
        const skill =
          requireNonEmptyString(args, 'skill') ?? requireNonEmptyString(args, 'pack');
        if (!skill) {
          return {
            ok: false,
            output: 'Error: `skill` is required for action="load" (legacy `pack` alias accepted).',
            error: 'missing skill'
          };
        }
      }
      return { ok: true };
    }
    case 'todos': {
      if (args['todos'] === undefined) return { ok: true };
      if (!Array.isArray(args['todos'])) {
        return {
          ok: false,
          output: 'Error: `todos` must be an array when writing.',
          error: 'invalid todos'
        };
      }
      if (args['todos'].length > TASK_LIST_MAX_ITEMS) {
        return {
          ok: false,
          output: `Error: \`todos\` exceeds the ${TASK_LIST_MAX_ITEMS} item cap.`,
          error: 'todos too long'
        };
      }
      const validStatuses = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
      for (const raw of args['todos']) {
        if (typeof raw !== 'object' || raw === null) {
          return {
            ok: false,
            output: 'Error: each todo item must be an object with `id`, `content`, and `status`.',
            error: 'invalid todo item'
          };
        }
        const item = raw as Record<string, unknown>;
        if (typeof item['id'] !== 'string' || !item['id'].trim()) {
          return {
            ok: false,
            output: 'Error: each todo item requires a non-empty string `id`.',
            error: 'missing todo id'
          };
        }
        if (typeof item['content'] !== 'string' || !item['content'].trim()) {
          return {
            ok: false,
            output: 'Error: each todo item requires non-empty string `content`.',
            error: 'missing todo content'
          };
        }
        if (item['content'].trim().length > TASK_CONTENT_MAX_CHARS) {
          return {
            ok: false,
            output: `Error: todo content exceeds ${TASK_CONTENT_MAX_CHARS} characters.`,
            error: 'todo content too long'
          };
        }
        if (typeof item['status'] !== 'string' || !validStatuses.has(item['status'])) {
          return {
            ok: false,
            output:
              'Error: each todo item requires `status` of pending, in_progress, completed, or cancelled.',
            error: 'invalid todo status'
          };
        }
        if (item['parentId'] !== undefined && item['parentId'] !== null) {
          if (typeof item['parentId'] !== 'string' || !item['parentId'].trim()) {
            return {
              ok: false,
              output: 'Error: `parentId` must be a non-empty string when provided.',
              error: 'invalid parentId'
            };
          }
          if (item['parentId'].trim() === item['id'].trim()) {
            return {
              ok: false,
              output: 'Error: a todo item cannot be its own parent.',
              error: 'self parentId'
            };
          }
        }
      }
      return { ok: true };
    }
    case 'ls': {
      const pathArg = args['path'];
      if (pathArg !== undefined && (typeof pathArg !== 'string' || !pathArg.trim())) {
        return {
          ok: false,
          output: 'Error: `path` must be a non-empty string when provided.',
          error: 'invalid path'
        };
      }
      const depth = args['depth'];
      if (depth !== undefined && (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0)) {
        return {
          ok: false,
          output: 'Error: `depth` must be a non-negative number when provided.',
          error: 'invalid depth'
        };
      }
      return { ok: true };
    }
    case 'heartbeat': {
      const action = args['action'];
      if (action !== 'attach' && action !== 'detach' && action !== 'status') {
        return {
          ok: false,
          output: 'Error: `action` must be attach, detach, or status.',
          error: 'invalid action'
        };
      }
      if (action === 'attach') {
        const interval = args['intervalMinutes'];
        if (
          typeof interval !== 'number' ||
          !Number.isFinite(interval) ||
          interval < HEARTBEAT_MIN_INTERVAL_MINUTES ||
          interval > HEARTBEAT_MAX_INTERVAL_MINUTES
        ) {
          return {
            ok: false,
            output: `Error: attach requires \`intervalMinutes\` between ${HEARTBEAT_MIN_INTERVAL_MINUTES} and ${HEARTBEAT_MAX_INTERVAL_MINUTES}.`,
            error: 'invalid intervalMinutes'
          };
        }
      }
      return { ok: true };
    }
    case 'continue': {
      const prompt = args['prompt'];
      if (prompt !== undefined && (typeof prompt !== 'string' || !prompt.trim())) {
        return {
          ok: false,
          output: 'Error: `prompt` must be a non-empty string when provided.',
          error: 'invalid prompt'
        };
      }
      return { ok: true };
    }
    case 'finish':
    case 'ask_user':
      return { ok: true };
    default: {
      const _exhaustive: never = toolName;
      return _exhaustive;
    }
  }
}
