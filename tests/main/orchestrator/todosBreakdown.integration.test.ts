/**
 * Integration tests for the host todos breakdown pipeline:
 * model writes an early plan → sidecar persists → envelope cache invalidates →
 * `<run_progress>` reflects the checklist on the next refresh.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { PartialToolCall } from '@main/orchestrator/loop/handleAssistantTurn.js';

const state = vi.hoisted(() => ({ tasksRoot: '' }));

vi.mock('@main/paths/userDataLayout.js', () => ({
  tasksDir: () => state.tasksRoot
}));

vi.mock('@main/memory/retrieval', () => ({
  retrieveRelevantMemory: vi.fn(async () => ({ metaRules: '', notes: [] }))
}));
vi.mock('@main/workspace/workspaceState', () => ({
  getWorkspace: vi.fn(async () => ({ path: null, label: null }))
}));
vi.mock('@main/conversations/conversationStore', () => ({
  listConversations: vi.fn(async () => [])
}));
vi.mock('@main/memory/workspaceNotes.js', () => ({
  readWorkspaceNote: vi.fn(async () => null)
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readdir: vi.fn(async () => [])
    }
  };
});

const runToolByName = vi.fn();

vi.mock('@main/orchestrator/toolRunner', () => ({
  runToolByName: (...args: unknown[]) => runToolByName(...args)
}));

import {
  __resetEnvelopeCacheForTests,
  refreshEnvelopes
} from '@main/orchestrator/contextManager.js';
import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls.js';
import { todosTool } from '@main/tools/todos.tool.js';

describe('todos breakdown integration', () => {
  beforeEach(async () => {
    __resetEnvelopeCacheForTests();
    state.tasksRoot = await mkdtemp(join(tmpdir(), 'vyotiq-todos-integration-'));
    runToolByName.mockImplementation(async (name, args, ctx) => {
      if (name === 'todos') return todosTool.run(args, ctx);
      throw new Error(`unexpected tool ${name}`);
    });
  });

  afterEach(async () => {
    try {
      await rm(state.tasksRoot, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('surfaces an early multi-step plan in run_progress after the first todos write', async () => {
    const events: TimelineEvent[] = [];
    const messages: ChatMessage[] = [];
    const multiStepPlan: PartialToolCall[] = [
      {
        id: 'tc-1',
        name: 'todos',
        argumentsBuf: JSON.stringify({
          todos: [
            { id: '1', content: 'Read the auth module', status: 'in_progress' },
            { id: '2', content: 'Add the login route', status: 'pending' },
            { id: '3', content: 'Write tests', status: 'pending' }
          ]
        })
      }
    ];

    const before = await refreshEnvelopes(
      'Implement auth with login route and tests',
      'conv-breakdown',
      '/tmp/ws',
      'ws-1'
    );
    expect(before.runProgressXml).toBe('');

    await handleToolCalls(multiStepPlan, messages, (e) => events.push(e), {
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-1',
      runId: 'run-1',
      conversationId: 'conv-breakdown',
      signal: new AbortController().signal,
      allowlist: ['todos']
    });

    const update = events.find((e) => e.kind === 'todos-update');
    expect(update?.kind).toBe('todos-update');
    if (update?.kind === 'todos-update') {
      expect(update.items).toHaveLength(3);
    }

    const after = await refreshEnvelopes(
      'Implement auth with login route and tests',
      'conv-breakdown',
      '/tmp/ws',
      'ws-1'
    );
    expect(after.runProgressXml).toContain('Read the auth module');
    expect(after.runProgressXml).toContain('Add the login route');
    expect(after.runProgressXml).toContain('Write tests');
  });

  it('surfaces nested plans as a numbered outline in run_progress', async () => {
    const events: TimelineEvent[] = [];
    const nestedPlan: PartialToolCall[] = [
      {
        id: 'tc-nested',
        name: 'todos',
        argumentsBuf: JSON.stringify({
          todos: [
            { id: 'p1', content: 'Implement auth', status: 'pending' },
            { id: 's1', parentId: 'p1', content: 'Read the auth module', status: 'in_progress' },
            { id: 's2', parentId: 'p1', content: 'Add the login route', status: 'pending' }
          ]
        })
      }
    ];

    await handleToolCalls(nestedPlan, [], (e) => events.push(e), {
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-1',
      runId: 'run-1',
      conversationId: 'conv-nested',
      signal: new AbortController().signal,
      allowlist: ['todos']
    });

    const after = await refreshEnvelopes(
      'Implement auth',
      'conv-nested',
      '/tmp/ws',
      'ws-1'
    );
    expect(after.runProgressXml).toContain('1. [ ] Implement auth');
    expect(after.runProgressXml).toContain('1.1 Read the auth module (in progress)');
    expect(after.runProgressXml).toContain('1.2 [ ] Add the login route');
  });

  it('rejects malformed todos writes before toolRunner dispatch', async () => {
    const messages: ChatMessage[] = [];
    const badCall: PartialToolCall[] = [
      {
        id: 'tc-bad',
        name: 'todos',
        argumentsBuf: JSON.stringify({ todos: [{ id: '1', content: 'missing status field' }] })
      }
    ];

    const summary = await handleToolCalls(badCall, messages, () => undefined, {
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-1',
      runId: 'run-1',
      conversationId: 'conv-breakdown',
      signal: new AbortController().signal,
      allowlist: ['todos']
    });

    expect(runToolByName).not.toHaveBeenCalled();
    expect(summary.failed).toBe(1);
  });
});
