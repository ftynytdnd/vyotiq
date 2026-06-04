import { describe, expect, it } from 'vitest';
import { segmentDelegationStream } from '@renderer/components/timeline/delegation/segmentDelegationStream.js';
import type { DisplayRow } from '@renderer/components/timeline/shared/displayRowTypes.js';

describe('segmentDelegationStream', () => {
  it('keeps true wire order between orchestrator and worker segments', () => {
    const rows: DisplayRow[] = [
      { kind: 'assistant-text', key: 'o1', id: 'a-orc' },
      { kind: 'subagent-line', key: 's1', subagentId: 'w1' },
      { kind: 'assistant-text', key: 'w1', id: 'a-w1', subagentId: 'w1' },
      { kind: 'assistant-text', key: 'o2', id: 'a-orc2' },
      { kind: 'subagent-line', key: 's2', subagentId: 'w2' },
      { kind: 'assistant-text', key: 'w2', id: 'a-w2', subagentId: 'w2' }
    ];

    const segments = segmentDelegationStream(rows);
    expect(segments.map((s) => s.kind)).toEqual([
      'orchestrator',
      'worker',
      'orchestrator',
      'worker'
    ]);
    expect(segments[1]).toMatchObject({ kind: 'worker', subagentId: 'w1' });
    expect(segments[3]).toMatchObject({ kind: 'worker', subagentId: 'w2' });
  });

  it('forces orchestrator delegate tool-groups out of worker segments', () => {
    const rows: DisplayRow[] = [
      { kind: 'subagent-line', key: 's1', subagentId: 'w1' },
      {
        kind: 'tool-group',
        key: 'tg-delegate',
        toolName: 'delegate',
        subagentId: 'w1',
        children: []
      },
      { kind: 'assistant-text', key: 'w1', id: 'a-w1', subagentId: 'w1' }
    ];

    const segments = segmentDelegationStream(rows);
    const orch = segments.filter((s) => s.kind === 'orchestrator');
    const workers = segments.filter((s) => s.kind === 'worker');
    expect(orch.some((s) => s.rows.some((r) => r.kind === 'tool-group' && r.toolName === 'delegate'))).toBe(
      true
    );
    expect(workers.every((s) => !s.rows.some((r) => r.kind === 'tool-group' && r.toolName === 'delegate'))).toBe(
      true
    );
    expect(workers.some((s) => s.subagentId === 'w1')).toBe(true);
  });

  it('treats rows without subagentId as orchestrator', () => {
    const rows: DisplayRow[] = [
      { kind: 'subagent-line', key: 's1', subagentId: 'w1' },
      { kind: 'assistant-text', key: 'o', id: 'a-orc' },
      { kind: 'assistant-text', key: 'w1', id: 'a-w1', subagentId: 'w1' }
    ];

    const segments = segmentDelegationStream(rows);
    expect(segments.map((s) => s.kind)).toEqual(['worker', 'orchestrator', 'worker']);
  });
});
