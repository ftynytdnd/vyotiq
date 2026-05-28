/**
 * Turn zone partitioner — classification and within-turn reorder.
 */

import { describe, expect, it } from 'vitest';
import type { DisplayRow } from '@renderer/components/timeline/shared/projectSubagentRows';
import {
  partitionTurnSegment,
  reorderTurnSegment
} from '@renderer/components/timeline/shared/groupTurnSegment';
import { reorderRowsWithinTurns } from '@renderer/components/timeline/shared/turnRowOrdering';

const prompt = (id: string): DisplayRow => ({
  kind: 'user-prompt',
  key: id,
  id,
  content: 'hello'
});

const assistant = (id: string): DisplayRow => ({
  kind: 'assistant-text',
  key: `text:${id}`,
  id
});

const toolGroup = (key: string): DisplayRow => ({
  kind: 'tool-group',
  key,
  toolName: 'read',
  children: []
});

const runComplete = (key: string): DisplayRow => ({
  kind: 'run-complete',
  key,
  durationMs: 4200,
  completedAt: 1_700_000_004_200
});

describe('groupTurnSegment', () => {
  it('partitions a turn into prompt, activity, response, and footer', () => {
    const segment: DisplayRow[] = [
      prompt('p1'),
      toolGroup('tg-1'),
      assistant('a1'),
      runComplete('rc-1')
    ];
    const partitioned = partitionTurnSegment(segment);
    expect(partitioned.prompt?.kind).toBe('user-prompt');
    expect(partitioned.activity.map((r) => r.key)).toEqual(['tg-1']);
    expect(partitioned.response?.kind).toBe('assistant-text');
    expect(partitioned.footer.map((r) => r.key)).toEqual(['rc-1']);
    expect(partitioned.agentStream.map((r) => r.kind)).toEqual([
      'tool-group',
      'assistant-text'
    ]);
  });

  it('preserves wire order by default in partitionTurnSegment', () => {
    const segment: DisplayRow[] = [
      prompt('p1'),
      assistant('a1'),
      toolGroup('tg-1'),
      runComplete('rc-1')
    ];
    const partitioned = partitionTurnSegment(segment);
    expect(partitioned.agentStream.map((r) => r.kind)).toEqual([
      'assistant-text',
      'tool-group'
    ]);
  });

  it('can opt into legacy activity-first reorder', () => {
    const segment: DisplayRow[] = [
      prompt('p1'),
      assistant('a1'),
      toolGroup('tg-1'),
      runComplete('rc-1')
    ];
    const partitioned = partitionTurnSegment(segment, { chronological: false });
    expect(partitioned.agentStream.map((r) => r.kind)).toEqual([
      'tool-group',
      'assistant-text'
    ]);
  });

  it('reorders wire-order segment to activity → response → footer', () => {
    const segment: DisplayRow[] = [
      prompt('p1'),
      assistant('a1'),
      toolGroup('tg-1'),
      runComplete('rc-1')
    ];
    const ordered = reorderTurnSegment(segment);
    expect(ordered.map((r) => r.kind)).toEqual([
      'user-prompt',
      'tool-group',
      'assistant-text',
      'run-complete'
    ]);
  });

  it('reorders flat rows within each turn boundary', () => {
    const rows: DisplayRow[] = [
      prompt('p1'),
      assistant('a1'),
      toolGroup('tg-1'),
      runComplete('rc-1'),
      prompt('p2'),
      assistant('a2')
    ];
    const ordered = reorderRowsWithinTurns(rows);
    expect(ordered.map((r) => r.kind)).toEqual([
      'user-prompt',
      'tool-group',
      'assistant-text',
      'run-complete',
      'user-prompt',
      'assistant-text'
    ]);
  });

});
