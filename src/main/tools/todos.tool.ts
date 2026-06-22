/**
 * `todos` tool — the agent's structured task list for the current
 * conversation.
 *
 * One call writes the FULL plan (replace) or patches it by id (merge); calling
 * with no `todos` reads the current list. The list is persisted to a
 * per-conversation sidecar (`tasks/taskStore.ts`) that backs the
 * `<run_progress>` context slot, and a `todos-update` timeline event is emitted
 * so the composer task tray updates live and the transcript replays the final
 * plan.
 *
 * This is NOT a delegation/sub-agent tool — Vyotiq has a single agent. It is a
 * focus + progress-tracking aid: decompose a multi-step task, keep exactly one
 * item `in_progress`, and mark items `completed` as you finish them.
 */

import { randomUUID } from 'node:crypto';
import type { Tool } from './types.js';
import type { ToolData, ToolResult } from '@shared/types/tool.js';
import { normalizeTaskItems, renderTaskListMarkdown, type TaskItem } from '@shared/types/task.js';
import { readTaskList, writeTaskList } from '../tasks/taskStore.js';

interface TodosArgs {
  todos?: unknown;
  merge?: boolean;
}

export const todosTool: Tool = {
  name: 'todos',
  briefMarkdown: `### Tool: \`todos\`

**WHAT it is.** Your structured task list for THIS conversation. The user sees
it live in a task tray above the composer and can check items off or edit them;
your current plan is also folded into \`<run_progress>\` so it survives
compaction and wake-ups.

**HOW to use it.** One call carries the whole plan.
- Provide a \`todos\` array to write; omit it to read the current list.
- \`merge: false\` (default) replaces the entire list with a fresh plan.
- \`merge: true\` updates existing items by \`id\` and appends new ones.
- Each item: \`{ id: string, content: string, status: "pending" | "in_progress" | "completed" | "cancelled" }\`.
- List order is priority order.

\`\`\`json
{ "name": "todos", "arguments": { "todos": [
  { "id": "1", "content": "Read the auth module", "status": "in_progress" },
  { "id": "2", "content": "Add the login route", "status": "pending" },
  { "id": "3", "content": "Write tests", "status": "pending" }
] } }
{ "name": "todos", "arguments": { "merge": true, "todos": [ { "id": "1", "content": "Read the auth module", "status": "completed" }, { "id": "2", "content": "Add the login route", "status": "in_progress" } ] } }
{ "name": "todos", "arguments": {} }
\`\`\`

**WHEN to trigger it.**
- Use for non-trivial tasks with 3+ steps, or when the user gives multiple tasks.
- Keep exactly ONE item \`in_progress\` at a time.
- Mark an item \`completed\` immediately when it is done — don't batch.
- If a step is abandoned, set it \`cancelled\` and add a revised item.
- Skip it for trivial, single-step work.

Always returns the full current list.`,
  schema: {
    type: 'function',
    function: {
      name: 'todos',
      description:
        'Manage your task list for the current conversation. Provide `todos` to write (replace or merge by id), or omit it to read. Use for multi-step work; keep one item in_progress and mark items completed as you finish.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'Task items to write. Omit to read the current list.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique item id.' },
                content: { type: 'string', description: 'Task description.' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed', 'cancelled']
                }
              },
              required: ['id', 'content', 'status']
            }
          },
          merge: {
            type: 'boolean',
            description:
              'true: update existing items by id and append new ones. false (default): replace the entire list.'
          }
        },
        required: []
      }
    }
  },
  async run(args, ctx): Promise<ToolResult> {
    const id = randomUUID();
    const started = Date.now();
    const a = args as TodosArgs;

    try {
      // Read path: no `todos` array supplied.
      if (a.todos === undefined) {
        const list = await readTaskList(ctx.conversationId);
        return ok(id, started, 'read', false, list.items);
      }

      if (!Array.isArray(a.todos)) {
        return fail(id, started, 'Tasks error: todos must be an array', 'todos must be an array');
      }

      const merge = a.merge === true;
      const incoming = normalizeTaskItems(a.todos, randomUUID);
      const list = await writeTaskList(ctx.conversationId, incoming, merge);

      // Live-update the renderer task tray + persist a transcript snapshot.
      ctx.emit({
        kind: 'todos-update',
        id: randomUUID(),
        ts: Date.now(),
        conversationId: ctx.conversationId,
        items: list.items
      });

      return ok(id, started, 'write', merge, list.items);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail(id, started, `Tasks error: ${msg}`, msg);
    }
  }
};

function ok(
  id: string,
  started: number,
  action: 'read' | 'write',
  merged: boolean,
  items: TaskItem[]
): ToolResult {
  const md = renderTaskListMarkdown(items);
  const output = items.length === 0 ? 'Task list is empty.' : md;
  const data: ToolData = {
    tool: 'todos',
    action,
    merged: action === 'write' ? merged : undefined,
    count: items.length,
    items
  };
  return { id, name: 'todos', ok: true, output, data, durationMs: Date.now() - started };
}

function fail(id: string, started: number, output: string, error: string): ToolResult {
  return { id, name: 'todos', ok: false, output, error, durationMs: Date.now() - started };
}
