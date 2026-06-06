import { describe, expect, it } from 'vitest';
import {
  findTurnIndexForRowKey,
  promptTurnIndices
} from '@renderer/components/timeline/shared/timelineVirtualNav.js';
import type { DisplayRow } from '@renderer/components/timeline/shared/displayRowTypes.js';

describe('timelineVirtualNav', () => {
  const segments: DisplayRow[][] = [
    [{ kind: 'user-prompt', key: 'p1', id: 'p1', content: 'one' }],
    [
      { kind: 'user-prompt', key: 'p2', id: 'p2', content: 'two' },
      { kind: 'assistant-text', key: 'a1', id: 'a1' }
    ]
  ];

  it('finds turn index for a row key', () => {
    expect(findTurnIndexForRowKey(segments, 'a1')).toBe(1);
    expect(findTurnIndexForRowKey(segments, 'missing')).toBe(-1);
  });

  it('lists turn indices that contain prompts', () => {
    expect(promptTurnIndices(segments)).toEqual([0, 1]);
  });
});
