/**
 * Tests for the global toast store. Locks down stack-cap behavior,
 * auto-dismissal, and explicit dismissal.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useToastStore } from '@renderer/store/useToastStore';

beforeEach(() => {
  vi.useFakeTimers();
  // Drain any toasts left over from a prior test.
  for (const t of useToastStore.getState().toasts) {
    useToastStore.getState().dismiss(t.id);
  }
});

describe('useToastStore', () => {
  it('shows a toast and exposes it on the queue', () => {
    useToastStore.getState().show('hello');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.message).toBe('hello');
    expect(useToastStore.getState().toasts[0]?.tone).toBe('info');
  });

  it('auto-dismisses after the default duration', () => {
    useToastStore.getState().show('flash', 'success');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4_000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('respects an explicit duration', () => {
    useToastStore.getState().show('quick', 'info', 100);
    vi.advanceTimersByTime(50);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(60);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('caps the stack at MAX_STACK by trimming the oldest entries', () => {
    for (let i = 0; i < 6; i++) {
      useToastStore.getState().show(`t${i}`);
    }
    const queue = useToastStore.getState().toasts;
    expect(queue.length).toBeLessThanOrEqual(4);
    // Oldest must have been trimmed; newest survives.
    expect(queue.find((t) => t.message === 't5')).toBeDefined();
    expect(queue.find((t) => t.message === 't0')).toBeUndefined();
  });

  it('dismiss removes the matching toast and clears its timer', () => {
    useToastStore.getState().show('first');
    const id = useToastStore.getState().toasts[0]!.id;
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
    // Advancing past the auto-dismiss window must not throw or
    // accidentally re-resurrect the toast.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('keeps danger toasts until explicitly dismissed (POL-1)', () => {
    useToastStore.getState().show('boom', 'danger');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    useToastStore.getState().dismiss(useToastStore.getState().toasts[0]!.id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
