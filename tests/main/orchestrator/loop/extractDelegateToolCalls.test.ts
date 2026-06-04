/**
 * `extractDelegateToolCalls` — delegate-as-tool-call intercept unit tests.
 *
 * The orchestrator's function-calling schema does NOT include `delegate`
 * (see `tools/policy/orchestratorTools.ts`), but some models hallucinate
 * it as a tool_call. `extractDelegateToolCalls` partitions finished tool
 * calls so hallucinated delegates are converted to `ParsedDelegate`
 * objects and routed through the directive flow, avoiding a wasted
 * refuse-and-retry round-trip.
 *
 * These tests exercise:
 *   - Normal tool calls pass through untouched.
 *   - Valid delegate tool calls are converted to `ParsedDelegate`.
 *   - `files` / `tools` work as both comma-separated strings and
 *     JSON arrays.
 *   - Missing `id` or `task` route to `invalidDelegateCalls` for a
 *     synthetic validation error (not the intercept stub).
 *   - Mixed batches (real tools + delegate) partition correctly.
 */

import { describe, expect, it } from 'vitest';
import { extractDelegateToolCalls } from '@main/orchestrator/loop/runLoop';

describe('extractDelegateToolCalls', () => {
  it('passes normal tool calls through as realToolCalls', () => {
    const finished = [
      { id: 'c1', name: 'ls', argumentsBuf: '{"path":"."}' },
      { id: 'c2', name: 'memory', argumentsBuf: '{"key":"foo","value":"bar"}' }
    ];
    const { realToolCalls, toolSourcedDelegates } = extractDelegateToolCalls(finished);
    expect(realToolCalls).toHaveLength(2);
    expect(toolSourcedDelegates).toHaveLength(0);
    expect(realToolCalls).toEqual(finished);
  });

  it('converts a valid delegate tool call to a ParsedDelegate', () => {
    const finished = [
      {
        id: 'tc-d1',
        name: 'delegate',
        argumentsBuf: JSON.stringify({
          id: 'A1',
          task: 'Read the entry point',
          files: 'src/main/index.ts,README.md',
          tools: 'read'
        })
      }
    ];
    const { realToolCalls, toolSourcedDelegates } = extractDelegateToolCalls(finished);
    expect(realToolCalls).toHaveLength(0);
    expect(toolSourcedDelegates).toHaveLength(1);
    expect(toolSourcedDelegates[0]).toEqual({
      id: 'A1',
      task: 'Read the entry point',
      files: ['src/main/index.ts', 'README.md'],
      tools: ['read']
    });
  });

  it('handles files and tools as JSON arrays', () => {
    const finished = [
      {
        id: 'tc-d2',
        name: 'delegate',
        argumentsBuf: JSON.stringify({
          id: 'A2',
          task: 'Edit two files',
          files: ['src/a.ts', 'src/b.ts'],
          tools: ['read', 'edit']
        })
      }
    ];
    const { realToolCalls, toolSourcedDelegates } = extractDelegateToolCalls(finished);
    expect(realToolCalls).toHaveLength(0);
    expect(toolSourcedDelegates).toHaveLength(1);
    expect(toolSourcedDelegates[0]).toEqual({
      id: 'A2',
      task: 'Edit two files',
      files: ['src/a.ts', 'src/b.ts'],
      tools: ['read', 'edit']
    });
  });

  it('routes invalid delegate args to invalidDelegateCalls when id is missing', () => {
    const finished = [
      {
        id: 'tc-bad1',
        name: 'delegate',
        argumentsBuf: JSON.stringify({ task: 'something', files: 'a.ts', tools: 'read' })
      }
    ];
    const { realToolCalls, toolSourcedDelegates, invalidDelegateCalls } =
      extractDelegateToolCalls(finished);
    expect(realToolCalls).toHaveLength(0);
    expect(toolSourcedDelegates).toHaveLength(0);
    expect(invalidDelegateCalls).toHaveLength(1);
    expect(invalidDelegateCalls[0]!.id).toBe('tc-bad1');
  });

  it('routes invalid delegate args to invalidDelegateCalls when task is missing', () => {
    const finished = [
      {
        id: 'tc-bad2',
        name: 'delegate',
        argumentsBuf: JSON.stringify({ id: 'A1', files: 'a.ts', tools: 'read' })
      }
    ];
    const { realToolCalls, toolSourcedDelegates, invalidDelegateCalls } =
      extractDelegateToolCalls(finished);
    expect(realToolCalls).toHaveLength(0);
    expect(toolSourcedDelegates).toHaveLength(0);
    expect(invalidDelegateCalls).toHaveLength(1);
  });

  it('routes malformed delegate JSON to invalidDelegateCalls', () => {
    const finished = [
      {
        id: 'tc-bad3',
        name: 'delegate',
        argumentsBuf: '{broken json'
      }
    ];
    const { realToolCalls, toolSourcedDelegates, invalidDelegateCalls } =
      extractDelegateToolCalls(finished);
    expect(realToolCalls).toHaveLength(0);
    expect(toolSourcedDelegates).toHaveLength(0);
    expect(invalidDelegateCalls).toHaveLength(1);
  });

  it('partitions a mixed batch correctly', () => {
    const finished = [
      { id: 'c1', name: 'ls', argumentsBuf: '{"path":"."}' },
      {
        id: 'tc-d1',
        name: 'delegate',
        argumentsBuf: JSON.stringify({ id: 'A1', task: 'do stuff', files: 'a.ts', tools: 'read' })
      },
      { id: 'c2', name: 'memory', argumentsBuf: '{"key":"k","value":"v"}' },
      {
        id: 'tc-d2',
        name: 'delegate',
        argumentsBuf: JSON.stringify({ id: 'A2', task: 'do more', files: 'b.ts', tools: 'edit' })
      }
    ];
    const { realToolCalls, toolSourcedDelegates } = extractDelegateToolCalls(finished);
    expect(realToolCalls).toHaveLength(2);
    expect(realToolCalls.map((tc) => tc.name)).toEqual(['ls', 'memory']);
    expect(toolSourcedDelegates).toHaveLength(2);
    expect(toolSourcedDelegates.map((d) => d.id)).toEqual(['A1', 'A2']);
  });

  it('treats empty files/tools as empty arrays', () => {
    const finished = [
      {
        id: 'tc-d3',
        name: 'delegate',
        argumentsBuf: JSON.stringify({ id: 'A3', task: 'minimal delegate' })
      }
    ];
    const { toolSourcedDelegates } = extractDelegateToolCalls(finished);
    expect(toolSourcedDelegates).toHaveLength(1);
    expect(toolSourcedDelegates[0]!.files).toEqual([]);
    expect(toolSourcedDelegates[0]!.tools).toEqual([]);
  });

  // ── Batched-array normalization ───────────────────────────────────
  // The canonical fan-out is N parallel `delegate` calls in one turn,
  // but the loop also leniently accepts a SINGLE `delegate` call whose
  // args carry an array of specs — either as the whole args array or
  // under a wrapper key.

  it('normalizes a single delegate call whose args are a bare array of specs', () => {
    const finished = [
      {
        id: 'tc-batch',
        name: 'delegate',
        argumentsBuf: JSON.stringify([
          { id: 'A1', task: 'first', files: ['a.ts'], tools: ['read'] },
          { id: 'A2', task: 'second', files: 'b.ts', tools: 'edit' }
        ])
      }
    ];
    const { realToolCalls, toolSourcedDelegates } = extractDelegateToolCalls(finished);
    expect(realToolCalls).toHaveLength(0);
    expect(toolSourcedDelegates).toHaveLength(2);
    expect(toolSourcedDelegates.map((d) => d.id)).toEqual(['A1', 'A2']);
    expect(toolSourcedDelegates[1]).toEqual({
      id: 'A2',
      task: 'second',
      files: ['b.ts'],
      tools: ['edit']
    });
  });

  it.each(['delegates', 'tasks', 'items', 'specs'])(
    'normalizes a single delegate call carrying specs under the %s wrapper key',
    (key) => {
      const finished = [
        {
          id: 'tc-wrapped',
          name: 'delegate',
          argumentsBuf: JSON.stringify({
            [key]: [
              { id: 'B1', task: 'one' },
              { id: 'B2', task: 'two' }
            ]
          })
        }
      ];
      const { realToolCalls, toolSourcedDelegates } = extractDelegateToolCalls(finished);
      expect(realToolCalls).toHaveLength(0);
      expect(toolSourcedDelegates.map((d) => d.id)).toEqual(['B1', 'B2']);
    }
  );

  it('dedupes duplicate delegate ids (last spec wins)', () => {
    const finished = [
      {
        id: 'tc-dup',
        name: 'delegate',
        argumentsBuf: JSON.stringify({
          id: 'test_run',
          task: 'first task'
        })
      },
      {
        id: 'tc-dup2',
        name: 'delegate',
        argumentsBuf: JSON.stringify({
          id: 'test_run',
          task: 'second task'
        })
      }
    ];
    const { toolSourcedDelegates } = extractDelegateToolCalls(finished);
    expect(toolSourcedDelegates).toHaveLength(1);
    expect(toolSourcedDelegates[0]?.task).toBe('second task');
  });

  it('drops invalid specs inside a batched array but keeps the valid ones', () => {
    const finished = [
      {
        id: 'tc-mixed-batch',
        name: 'delegate',
        argumentsBuf: JSON.stringify([
          { id: 'A1', task: 'valid' },
          { task: 'missing id' },
          { id: 'A3', task: 'also valid' }
        ])
      }
    ];
    const { realToolCalls, toolSourcedDelegates } = extractDelegateToolCalls(finished);
    expect(realToolCalls).toHaveLength(0);
    expect(toolSourcedDelegates.map((d) => d.id)).toEqual(['A1', 'A3']);
  });
});
