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

  it('tags tool-group and file-edit-group with subagentId', () => {
    const rows = deriveRows([
      USER,
      {
        kind: 'tool-call',
        id: 'tc1',
        ts: 1,
        subagentId: 'W1',
        call: { id: 'c1', name: 'read', args: { path: 'a.ts' } }
      },
      {
        kind: 'file-edit',
        id: 'fe1',
        ts: 2,
        subagentId: 'W1',
        filePath: 'a.ts',
        additions: 1,
        deletions: 0
      }
    ]);
    const toolGroup = rows.find((r) => r.kind === 'tool-group');
    const fileEdit = rows.find((r) => r.kind === 'file-edit-group');
    expect(toolGroup).toMatchObject({ subagentId: 'W1' });
    expect(fileEdit).toMatchObject({ subagentId: 'W1' });
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
