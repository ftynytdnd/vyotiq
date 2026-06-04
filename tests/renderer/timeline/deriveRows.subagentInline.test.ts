/**
 * deriveRows — inline sub-agent rows tagged with subagentId in wire order.
 */

import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';

const USER: TimelineEvent = {
  kind: 'user-prompt',
  id: 'u1',
  ts: 0,
  content: 'delegate'
};

describe('deriveRows subagent inline', () => {
  it('tags assistant-text and reasoning-line with subagentId', () => {
    const rows = deriveRows([
      USER,
      { kind: 'agent-text-delta', id: 't1', ts: 1, subagentId: 'W1', delta: 'hello' },
      { kind: 'agent-reasoning-delta', id: 'r1', ts: 2, subagentId: 'W1', delta: 'think' }
    ]);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'assistant-text', id: 't1', subagentId: 'W1' }),
        expect.objectContaining({ kind: 'reasoning-line', id: 'r1', subagentId: 'W1' })
      ])
    );
  });

  it('tags tool-group with subagentId and folds edit file-edit into it', () => {
    const rows = deriveRows([
      USER,
      {
        kind: 'tool-call',
        id: 'tc1',
        ts: 1,
        subagentId: 'W1',
        call: { id: 'c1', name: 'edit', args: { path: 'a.ts', oldString: 'a', newString: 'b' } }
      },
      {
        kind: 'tool-result',
        id: 'tr1',
        ts: 2,
        subagentId: 'W1',
        result: {
          id: 'c1',
          name: 'edit',
          ok: true,
          output: 'ok',
          durationMs: 1,
          data: {
            tool: 'edit',
            filePath: 'a.ts',
            additions: 1,
            deletions: 0,
            created: false,
            hunks: []
          }
        }
      },
      {
        kind: 'file-edit',
        id: 'fe1',
        ts: 3,
        subagentId: 'W1',
        filePath: 'a.ts',
        additions: 1,
        deletions: 0
      }
    ]);
    const toolGroups = rows.filter((r) => r.kind === 'tool-group');
    const fileEditGroups = rows.filter((r) => r.kind === 'file-edit-group');
    expect(toolGroups).toHaveLength(1);
    expect(toolGroups[0]).toMatchObject({ subagentId: 'W1' });
    expect(fileEditGroups).toHaveLength(0);
  });

  it('keeps bare sub-agent file-edit as file-edit-group', () => {
    const rows = deriveRows([
      USER,
      {
        kind: 'file-edit',
        id: 'fe1',
        ts: 1,
        subagentId: 'W1',
        filePath: 'a.ts',
        additions: 1,
        deletions: 0
      }
    ]);
    expect(rows.some((r) => r.kind === 'file-edit-group' && r.subagentId === 'W1')).toBe(true);
  });

  it('does not emit phase rows', () => {
    const rows = deriveRows([
      USER,
      { kind: 'phase', id: 'p1', ts: 1, label: 'Exploring' },
      { kind: 'agent-text-delta', id: 'a1', ts: 2, delta: 'done' }
    ]);
    expect(rows.some((r) => r.kind === 'phase')).toBe(false);
  });

  it('preserves wire order across orchestrator and sub-agent boundaries', () => {
    const rows = deriveRows([
      USER,
      { kind: 'agent-text-delta', id: 'o1', ts: 1, delta: 'intro' },
      {
        kind: 'tool-call',
        id: 'tc1',
        ts: 2,
        subagentId: 'W1',
        call: { id: 'c1', name: 'grep', args: { pattern: 'foo' } }
      },
      { kind: 'agent-text-delta', id: 'o2', ts: 3, delta: 'outro' }
    ]);
    const kinds = rows
      .filter((r) => r.kind !== 'run-complete')
      .map((r) =>
      r.kind === 'assistant-text'
        ? `text:${r.subagentId ?? 'orc'}`
        : r.kind === 'tool-group'
          ? `tool:${r.subagentId ?? 'orc'}`
          : r.kind
    );
    expect(kinds).toEqual([
      'user-prompt',
      'text:orc',
      'subagent-line',
      'tool:W1',
      'text:orc'
    ]);
  });
});
