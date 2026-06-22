import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@main/tools/types.js';
import type { TimelineEvent } from '@shared/types/chat.js';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('@main/paths/userDataLayout.js', () => ({
  tasksDir: () => state.root
}));

import { todosTool } from '@main/tools/todos.tool.js';

function ctxFor(emit: (e: TimelineEvent) => void): ToolContext {
  return {
    workspacePath: '/tmp/ws',
    workspaceId: 'ws',
    runId: 'r',
    conversationId: 'conv-1',
    emit,
    signal: new AbortController().signal
  };
}

describe('todos.tool', () => {
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), 'vyotiq-todos-'));
  });

  afterEach(async () => {
    try {
      await rm(state.root, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('reads an empty list when nothing is written yet', async () => {
    const result = await todosTool.run({}, ctxFor(() => undefined));
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/empty/i);
    expect(result.data).toMatchObject({ tool: 'todos', action: 'read', count: 0 });
  });

  it('writes a list and emits a todos-update event', async () => {
    const events: TimelineEvent[] = [];
    const result = await todosTool.run(
      {
        todos: [
          { id: '1', content: 'do thing', status: 'in_progress' },
          { id: '2', content: 'next thing', status: 'pending' }
        ]
      },
      ctxFor((e) => events.push(e))
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ tool: 'todos', action: 'write', merged: false, count: 2 });

    const update = events.find((e) => e.kind === 'todos-update');
    expect(update).toBeDefined();
    if (update?.kind === 'todos-update') {
      expect(update.conversationId).toBe('conv-1');
      expect(update.items).toHaveLength(2);
    }
  });

  it('merges by id when merge=true', async () => {
    await todosTool.run(
      { todos: [{ id: '1', content: 'one', status: 'pending' }] },
      ctxFor(() => undefined)
    );
    const result = await todosTool.run(
      {
        merge: true,
        todos: [
          { id: '1', content: 'one', status: 'completed' },
          { id: '2', content: 'two', status: 'pending' }
        ]
      },
      ctxFor(() => undefined)
    );
    expect(result.data).toMatchObject({ action: 'write', merged: true, count: 2 });
    if (result.data?.tool === 'todos') {
      expect(result.data.items[0]).toMatchObject({ id: '1', status: 'completed' });
    }
  });

  it('rejects malformed todos input on write', async () => {
    const result = await todosTool.run({ todos: 'not-an-array' }, ctxFor(() => undefined));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/array/i);
  });
});
