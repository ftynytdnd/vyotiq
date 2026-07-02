/**
 * Turn zone partitioner — classification tests.
 */

import { describe, expect, it } from 'vitest';
import type { DisplayRow } from '@renderer/components/timeline/shared/displayRowTypes';
import { partitionTurnSegment } from '@renderer/components/timeline/shared/groupTurnSegment';

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

const runComplete = (key: string, promptId = 'p1'): DisplayRow => ({
  kind: 'run-complete',
  key,
  promptId,
  durationMs: 4200,
  completedAt: 1_700_000_004_200
});

describe('groupTurnSegment', () => {
  it('partitions a turn into prompt, agent stream, and footer', () => {
    const segment: DisplayRow[] = [
      prompt('p1'),
      toolGroup('tg-1'),
      assistant('a1'),
      runComplete('rc-1')
    ];
    const partitioned = partitionTurnSegment(segment);
    expect(partitioned.prompt?.kind).toBe('user-prompt');
    expect(partitioned.footer.map((r) => r.key)).toEqual(['rc-1']);
    expect(partitioned.agentStream.map((r) => r.kind)).toEqual([
      'tool-group',
      'assistant-text'
    ]);
  });

  it('preserves wire order in agentStream', () => {
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
});
