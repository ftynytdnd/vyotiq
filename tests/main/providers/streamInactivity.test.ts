/**
 * Tests for the stream-inactivity watchdog. Pins the contract the
 * openai / ollama transports rely on:
 *
 *   - Timer fires `StreamInactivityError` after `timeoutMs` without a
 *     `poke()`.
 *   - `poke()` resets the timer so a noisy connection never fires.
 *   - The parent `AbortSignal` propagates through with its own reason
 *     (so user Stop stays distinguishable from inactivity).
 *   - `dispose()` is idempotent and clears pending timers.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createInactivityWatch,
  isStreamInactivityError,
  StreamInactivityError
} from '@main/providers/streamInactivity';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createInactivityWatch', () => {
  it('aborts with StreamInactivityError after timeoutMs of silence', () => {
    const watch = createInactivityWatch({ timeoutMs: 100 });
    expect(watch.signal.aborted).toBe(false);

    vi.advanceTimersByTime(99);
    expect(watch.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(watch.signal.aborted).toBe(true);

    // AbortSignal.reason carries the dedicated error type so callers
    // can distinguish inactivity from a user Stop.
    const reason = (watch.signal as AbortSignal & { reason?: unknown }).reason;
    expect(isStreamInactivityError(reason)).toBe(true);
    expect(reason).toBeInstanceOf(StreamInactivityError);

    watch.dispose();
  });

  it('poke() resets the timer', () => {
    const watch = createInactivityWatch({ timeoutMs: 100 });

    // Advance to just before the deadline, then poke — should live on.
    vi.advanceTimersByTime(90);
    watch.poke();
    vi.advanceTimersByTime(90);
    expect(watch.signal.aborted).toBe(false);

    // Another 11ms with no poke → fires.
    vi.advanceTimersByTime(11);
    expect(watch.signal.aborted).toBe(true);
    watch.dispose();
  });

  it('parent signal propagation preserves parent reason (user Stop)', () => {
    const parent = new AbortController();
    const watch = createInactivityWatch({ timeoutMs: 100_000, parent: parent.signal });

    const userReason = new DOMException('User hit Stop', 'AbortError');
    parent.abort(userReason);

    expect(watch.signal.aborted).toBe(true);
    const reason = (watch.signal as AbortSignal & { reason?: unknown }).reason;
    // Parent's reason passes through — NOT wrapped as StreamInactivityError.
    expect(isStreamInactivityError(reason)).toBe(false);
    watch.dispose();
  });

  it('pre-aborted parent signal aborts the watch immediately', () => {
    const parent = new AbortController();
    parent.abort(new Error('already gone'));
    const watch = createInactivityWatch({ timeoutMs: 100, parent: parent.signal });
    expect(watch.signal.aborted).toBe(true);
    watch.dispose();
  });

  it('dispose() prevents the timer from firing after call', () => {
    const watch = createInactivityWatch({ timeoutMs: 100 });
    watch.dispose();
    vi.advanceTimersByTime(1000);
    expect(watch.signal.aborted).toBe(false);
  });

  it('dispose() is idempotent', () => {
    const watch = createInactivityWatch({ timeoutMs: 100 });
    watch.dispose();
    expect(() => watch.dispose()).not.toThrow();
  });

  it('poke() after dispose() is a harmless no-op', () => {
    const watch = createInactivityWatch({ timeoutMs: 100 });
    watch.dispose();
    expect(() => watch.poke()).not.toThrow();
    vi.advanceTimersByTime(1000);
    expect(watch.signal.aborted).toBe(false);
  });
});

describe('isStreamInactivityError', () => {
  it('true for actual StreamInactivityError instances', () => {
    expect(isStreamInactivityError(new StreamInactivityError(500))).toBe(true);
  });

  it('true for structurally-matching objects (cross-realm safety)', () => {
    // Some providers wrap errors across async boundaries; the
    // instanceof check can fail while the name still matches.
    expect(isStreamInactivityError({ name: 'StreamInactivityError' })).toBe(true);
  });

  it('false for a plain AbortError', () => {
    expect(isStreamInactivityError(new DOMException('Aborted', 'AbortError'))).toBe(false);
  });

  it('false for null / undefined / non-objects', () => {
    expect(isStreamInactivityError(null)).toBe(false);
    expect(isStreamInactivityError(undefined)).toBe(false);
    expect(isStreamInactivityError('string')).toBe(false);
  });
});
