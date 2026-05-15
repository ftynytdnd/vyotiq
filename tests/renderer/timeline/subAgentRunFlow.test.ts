/**
 * `buildSubAgentFlow` — chronological merge correctness.
 *
 * Pins the four invariants the new ordering layout depends on:
 *
 *   1. Per-iteration reasoning + text appears BEFORE the tool round
 *      that iteration produced (the model emits prose first, calls
 *      tools second).
 *   2. An iteration boundary closes any open tool-group, so two
 *      iterations' tool calls never roll up into a single row even
 *      when the same tool name is used in both.
 *   3. Inside one iteration's tool round, consecutive same-tool
 *      steps STILL fold into one `tool-group` (the Cascade-style
 *      compression we keep at the orchestrator level too).
 *   4. A `file-edit` event immediately after a successful `edit`
 *      step targeting the same path merges its diff stats into the
 *      prior step's `fileEditAdditions/Deletions` rather than
 *      opening a separate `file-edit-group` row.
 *
 * The ordering tie-break (iteration < step < edit when timestamps
 * match) is also pinned because real provider timing can produce
 * exact `startedAt` collisions on very fast turns.
 */

import { describe, expect, it } from 'vitest';
import { buildSubAgentFlow } from '@renderer/components/timeline/subagent/SubAgentRunFlow';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';
import type { ToolCall, ToolResult } from '@shared/types/tool';

function makeSnapshot(partial: Partial<SubAgentSnapshot>): SubAgentSnapshot {
  return {
    id: 'sub-A',
    task: 't',
    files: [],
    missingFiles: [],
    tools: [],
    status: 'running',
    startedAt: 0,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {},
    ...partial
  };
}

function call(id: string, name: ToolCall['name'], args: Record<string, unknown> = {}): ToolCall {
  return { id, name, args };
}

function result(id: string, name: ToolResult['name'], ok = true): ToolResult {
  return { id, name, ok, output: 'ok', durationMs: 1 };
}

describe('buildSubAgentFlow — chronological ordering', () => {
  it('renders iteration reasoning + text BEFORE the tool round it produced', () => {
    const snap = makeSnapshot({
      iterationOrder: ['iter-1'],
      reasoningTexts: {
        'iter-1': { id: 'iter-1', text: 'thinking', done: true, startedAt: 100, endedAt: 110 }
      },
      assistantTexts: {
        'iter-1': { id: 'iter-1', text: 'will read foo', done: true, startedAt: 115 }
      },
      steps: [
        {
          callId: 'c1',
          call: call('c1', 'read', { path: 'foo.ts' }),
          result: result('c1', 'read'),
          startedAt: 200,
          endedAt: 210
        }
      ]
    });
    const flow = buildSubAgentFlow(snap);
    expect(flow.map((g) => g.kind)).toEqual(['iteration', 'tool-group']);
    expect((flow[0] as { iterationId: string }).iterationId).toBe('iter-1');
    if (flow[1]?.kind !== 'tool-group') throw new Error('expected tool-group second');
    expect(flow[1].toolName).toBe('read');
    expect(flow[1].children).toHaveLength(1);
  });

  it('closes the tool-group at every iteration boundary (no cross-turn roll-up)', () => {
    // Two iterations, each calling `read` once. Pre-fix this would
    // collapse into one `Read 2 files` group across both turns —
    // exactly the wrong behaviour the user flagged.
    const snap = makeSnapshot({
      iterationOrder: ['iter-1', 'iter-2'],
      reasoningTexts: {},
      assistantTexts: {
        'iter-1': { id: 'iter-1', text: 'a', done: true, startedAt: 100 },
        'iter-2': { id: 'iter-2', text: 'b', done: true, startedAt: 300 }
      },
      steps: [
        { callId: 'c1', call: call('c1', 'read', { path: 'foo' }), result: result('c1', 'read'), startedAt: 150 },
        { callId: 'c2', call: call('c2', 'read', { path: 'bar' }), result: result('c2', 'read'), startedAt: 350 }
      ]
    });
    const flow = buildSubAgentFlow(snap);
    expect(flow.map((g) => g.kind)).toEqual([
      'iteration',
      'tool-group',
      'iteration',
      'tool-group'
    ]);
    // Each tool-group has ONE child — the iteration boundary
    // prevented the second `read` from folding into the first.
    expect((flow[1] as { children: unknown[] }).children).toHaveLength(1);
    expect((flow[3] as { children: unknown[] }).children).toHaveLength(1);
  });

  it('still folds consecutive same-tool steps inside ONE iteration', () => {
    // One iteration whose tool round called `read` twice in a row.
    // Both should fold into a single `tool-group` row (Cascade-style
    // compression preserved within a turn).
    const snap = makeSnapshot({
      iterationOrder: ['iter-1'],
      reasoningTexts: {},
      assistantTexts: {
        'iter-1': { id: 'iter-1', text: 'reading two', done: true, startedAt: 100 }
      },
      steps: [
        { callId: 'c1', call: call('c1', 'read', { path: 'foo' }), result: result('c1', 'read'), startedAt: 150 },
        { callId: 'c2', call: call('c2', 'read', { path: 'bar' }), result: result('c2', 'read'), startedAt: 160 }
      ]
    });
    const flow = buildSubAgentFlow(snap);
    expect(flow.map((g) => g.kind)).toEqual(['iteration', 'tool-group']);
    if (flow[1]?.kind !== 'tool-group') throw new Error('expected tool-group');
    expect(flow[1].children).toHaveLength(2);
  });

  it('merges a file-edit event into the prior successful edit step (no separate row)', () => {
    const editCall = call('c1', 'edit', { path: 'foo.ts' });
    const editRes: ToolResult = {
      id: 'c1',
      name: 'edit',
      ok: true,
      output: 'edited',
      data: {
        tool: 'edit',
        filePath: 'foo.ts',
        created: false,
        additions: 0,
        deletions: 0,
        hunks: []
      },
      durationMs: 1
    };
    const snap = makeSnapshot({
      iterationOrder: ['iter-1'],
      assistantTexts: {
        'iter-1': { id: 'iter-1', text: 'editing', done: true, startedAt: 100 }
      },
      steps: [
        { callId: 'c1', call: editCall, result: editRes, startedAt: 150, endedAt: 160 }
      ],
      fileEdits: [
        { key: 'fe-1', filePath: 'foo.ts', additions: 3, deletions: 1, ts: 165 }
      ]
    });
    const flow = buildSubAgentFlow(snap);
    // No `file-edit-group` — the edit folded into the tool-group's
    // child as additions/deletions.
    expect(flow.map((g) => g.kind)).toEqual(['iteration', 'tool-group']);
    if (flow[1]?.kind !== 'tool-group') throw new Error('expected tool-group');
    const child = flow[1].children[0]!;
    expect(child.fileEditAdditions).toBe(3);
    expect(child.fileEditDeletions).toBe(1);
  });

  it('emits a file-edit-group when an edit follows a NON-edit step', () => {
    // A read step followed by a file-edit (rare path but the merge
    // rule must NOT fold across tool kinds).
    const snap = makeSnapshot({
      steps: [
        { callId: 'c1', call: call('c1', 'read', { path: 'foo' }), result: result('c1', 'read'), startedAt: 150 }
      ],
      fileEdits: [
        { key: 'fe-1', filePath: 'foo.ts', additions: 1, deletions: 0, ts: 160 }
      ]
    });
    const flow = buildSubAgentFlow(snap);
    expect(flow.map((g) => g.kind)).toEqual(['tool-group', 'file-edit-group']);
  });

  it('renders steps with no iteration prose (pure tool-only worker) in chronological order', () => {
    // A worker that emitted only tool calls with no narrative.
    const snap = makeSnapshot({
      iterationOrder: [],
      steps: [
        { callId: 'c1', call: call('c1', 'read'), result: result('c1', 'read'), startedAt: 100 },
        { callId: 'c2', call: call('c2', 'bash'), result: result('c2', 'bash'), startedAt: 200 }
      ]
    });
    const flow = buildSubAgentFlow(snap);
    expect(flow.map((g) => g.kind)).toEqual(['tool-group', 'tool-group']);
    if (flow[0]?.kind !== 'tool-group') throw new Error('expected tool-group');
    if (flow[1]?.kind !== 'tool-group') throw new Error('expected tool-group');
    expect(flow[0].toolName).toBe('read');
    expect(flow[1].toolName).toBe('bash');
  });

  it('appends streaming partial-args entries at the tail in index order', () => {
    const snap = makeSnapshot({
      iterationOrder: ['iter-1'],
      assistantTexts: {
        'iter-1': { id: 'iter-1', text: 'about to', done: false, startedAt: 100 }
      },
      partialToolCallArgs: {
        'p2': { callId: 'p2', name: 'edit', index: 1, argsBuf: '{}', parsed: {}, ts: 200 },
        'p1': { callId: 'p1', name: 'edit', index: 0, argsBuf: '{}', parsed: {}, ts: 195 }
      }
    });
    const flow = buildSubAgentFlow(snap);
    // Iteration first, then ONE tool-group folding both partials by
    // ascending index (p1 then p2) since they share the `edit` tool.
    expect(flow.map((g) => g.kind)).toEqual(['iteration', 'tool-group']);
    if (flow[1]?.kind !== 'tool-group') throw new Error('expected tool-group');
    expect(flow[1].children.map((c) => c.callId)).toEqual(['p1', 'p2']);
    expect(flow[1].children.every((c) => c.partial === true)).toBe(true);
  });

  it('drops partial entries whose callId already settled into a step', () => {
    // The reducer wipes `partialToolCallArgs[callId]` on the
    // authoritative `tool-call` event, but a mid-frame snapshot
    // could still carry both. The flow MUST NOT double-render.
    const snap = makeSnapshot({
      steps: [
        { callId: 'c1', call: call('c1', 'read'), result: result('c1', 'read'), startedAt: 150 }
      ],
      partialToolCallArgs: {
        'c1': { callId: 'c1', name: 'read', index: 0, argsBuf: '{}', parsed: {}, ts: 145 }
      }
    });
    const flow = buildSubAgentFlow(snap);
    expect(flow).toHaveLength(1);
    if (flow[0]?.kind !== 'tool-group') throw new Error('expected tool-group');
    expect(flow[0].children).toHaveLength(1);
    expect(flow[0].children[0]!.partial).toBeUndefined();
  });

  it('places iteration before step when their startedAt matches exactly', () => {
    // Tie-break invariant: a turn whose first tool call lands in
    // the same millisecond as the iteration's first delta still
    // renders the prose panel ABOVE the tool row.
    const snap = makeSnapshot({
      iterationOrder: ['iter-1'],
      assistantTexts: {
        'iter-1': { id: 'iter-1', text: 'a', done: true, startedAt: 100 }
      },
      steps: [
        { callId: 'c1', call: call('c1', 'read'), result: result('c1', 'read'), startedAt: 100 }
      ]
    });
    const flow = buildSubAgentFlow(snap);
    expect(flow.map((g) => g.kind)).toEqual(['iteration', 'tool-group']);
  });
});
