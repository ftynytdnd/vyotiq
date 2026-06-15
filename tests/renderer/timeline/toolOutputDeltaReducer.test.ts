import { describe, expect, it } from 'vitest';
import { applyTimelineEvent } from '@renderer/components/timeline/reducer/applyTimelineEvent.js';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types.js';
import type { TimelineEvent } from '@shared/types/chat.js';

function outputDelta(
  callId: string,
  overrides: Partial<Extract<TimelineEvent, { kind: 'tool-output-delta' }>> = {}
): Extract<TimelineEvent, { kind: 'tool-output-delta' }> {
  return {
    kind: 'tool-output-delta',
    id: 'od-1',
    ts: 1,
    callId,
    tool: 'bash',
    command: 'npm test',
    stdout: 'line\n',
    stderr: '',
    startedAt: 0,
    ...overrides
  };
}

describe('applyTimelineEvent — tool-output-delta', () => {
  it('stores cumulative live bash output by callId', () => {
    const s = applyTimelineEvent(INITIAL_TIMELINE_STATE, outputDelta('c1'));
    expect(s.liveToolOutputByCallId['c1']?.stdout).toBe('line\n');
  });

  it('drops late deltas after tool-result settles', () => {
    let s = applyTimelineEvent(INITIAL_TIMELINE_STATE, outputDelta('c1'));
    s = applyTimelineEvent(s, {
      kind: 'tool-result',
      id: 'tr-1',
      ts: 2,
      result: {
        id: 'c1',
        name: 'bash',
        ok: true,
        output: 'done',
        durationMs: 1
      }
    });
    s = applyTimelineEvent(s, outputDelta('c1', { stdout: 'late\n', ts: 3 }));
    expect(s.liveToolOutputByCallId['c1']).toBeUndefined();
  });
});
