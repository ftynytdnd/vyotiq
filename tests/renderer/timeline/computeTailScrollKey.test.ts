/**
 * computeTailScrollKey — tail-follow growth includes tool-group diffs.
 */

import { describe, expect, it } from 'vitest';
import { computeTailScrollKey } from '@renderer/components/timeline/shared/computeTailScrollKey';
import type { Row } from '@renderer/components/timeline/reducer/deriveRows';

describe('computeTailScrollKey', () => {
  it('returns zero key for empty rows', () => {
    expect(computeTailScrollKey([], {}, {}, {}, {})).toBe('0');
  });

  it('grows when the tail tool-group diff stream changes', () => {
    const rows: Row[] = [
      {
        kind: 'tool-group',
        key: 'tg-1',
        toolName: 'edit',
        children: [{ callId: 'call-1', partial: true }]
      }
    ];
    const liveA = {
      'call-1': {
        tool: 'edit' as const,
        filePath: 'src/a.ts',
        additions: 1,
        deletions: 0,
        hunks: [],
        settled: false,
        ts: 1
      }
    };
    const liveB = {
      'call-1': {
        tool: 'edit' as const,
        filePath: 'src/a.ts',
        additions: 5,
        deletions: 2,
        hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+x'] }],
        settled: false,
        ts: 2
      }
    };
    const keyA = computeTailScrollKey(rows, {}, {}, {}, liveA);
    const keyB = computeTailScrollKey(rows, {}, {}, {}, liveB);
    expect(keyA).not.toBe(keyB);
    expect(keyB).toContain(':tg-1:');
  });

  it('grows with assistant text length on the tail row', () => {
    const rows: Row[] = [{ kind: 'assistant-text', key: 'at-1', id: 'turn-1' }];
    const short = computeTailScrollKey(rows, { 'turn-1': { text: 'hi' } }, {}, {}, {});
    const long = computeTailScrollKey(rows, { 'turn-1': { text: 'hello world' } }, {}, {}, {});
    expect(short).not.toBe(long);
  });
});
