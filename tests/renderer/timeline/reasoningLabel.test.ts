/**
 * Unit tests for `formatReasoningLabel`. Pins the contract that
 * `ReasoningLineRow` and worker reasoning subtitles share:
 *
 *   - Live (`done=false`) → `Thinking…`
 *   - Settled (`done=true`) → `Thought for Ns` where N is the rounded
 *     elapsed seconds, floored at 1.
 *   - When `endedAt` is omitted, elapsed is computed against the live
 *     clock so the label updates in real time on each render tick.
 *
 * Locking these via tests means a future label rewording (locale,
 * sub-second precision, etc.) requires both the helper and the tests
 * to move together — no silent drift between the orchestrator and
 * sub-agent surfaces.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { formatReasoningLabel } from '@renderer/lib/reasoningLabel';

afterEach(() => {
  vi.useRealTimers();
});

describe('formatReasoningLabel', () => {
  it('returns Thinking… while reasoning is still streaming', () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const out = formatReasoningLabel({ startedAt: now - 4_500, done: false });
    expect(out.text).toBe('Thinking…');
    expect(out.streaming).toBe(true);
    expect(out.elapsedSeconds).toBe(5);
  });

  it('returns Thought for Ns once reasoning settles', () => {
    const out = formatReasoningLabel({
      startedAt: 0,
      endedAt: 4_200,
      done: true
    });
    expect(out.text).toBe('Thought for 4s');
    expect(out.streaming).toBe(false);
    expect(out.elapsedSeconds).toBe(4);
  });

  it('floors elapsed at 1 second so a near-instant turn never reads 0s', () => {
    const out = formatReasoningLabel({
      startedAt: 0,
      endedAt: 100,
      done: true
    });
    expect(out.text).toBe('Thought for 1s');
    expect(out.elapsedSeconds).toBe(1);
  });

  it('rounds (does not truncate) the elapsed seconds', () => {
    // 1500 ms rounds to 2 s.
    const out = formatReasoningLabel({
      startedAt: 0,
      endedAt: 1_500,
      done: true
    });
    expect(out.text).toBe('Thought for 2s');
  });

  it('uses the live clock when endedAt is omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const out = formatReasoningLabel({ startedAt: 7_400, done: true });
    // 10000 - 7400 = 2600 → rounds to 3.
    expect(out.text).toBe('Thought for 3s');
  });

  it('honors `done` independently of `endedAt`', () => {
    // `done` true even though `endedAt` is missing: the past-tense label
    // is what flips, not the timestamp source.
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const out = formatReasoningLabel({ startedAt: 2_000, done: true });
    expect(out.text).toBe('Thought for 3s');
    expect(out.streaming).toBe(false);
  });
});
