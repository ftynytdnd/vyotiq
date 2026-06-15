import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BashOutputCapture } from '@main/tools/bashOutputCapture.js';
import type { TimelineEvent } from '@shared/types/chat.js';

describe('BashOutputCapture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits cumulative tool-output-delta frames throttled', () => {
    const events: TimelineEvent[] = [];
    const capture = new BashOutputCapture({
      callId: 'call-1',
      command: 'echo hi',
      emit: (e) => events.push(e),
      startedAt: 1_000
    });

    capture.appendStdout('line1\n');
    vi.advanceTimersByTime(100);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('tool-output-delta');
    if (events[0]?.kind !== 'tool-output-delta') return;
    expect(events[0].stdout).toBe('line1\n');

    capture.appendStdout('line2');
    vi.advanceTimersByTime(100);
    expect(events).toHaveLength(2);
    if (events[1]?.kind !== 'tool-output-delta') return;
    expect(events[1].stdout).toBe('line1\nline2');

    capture.close();
  });
});
