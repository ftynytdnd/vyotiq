/**
 * `useLiveTokenRate` — rolling-window sampling lifecycle.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveTokenRate } from '@renderer/lib/useLiveTokenRate';
import { LIVE_TOKEN_RATE_MIN_SPAN_MS, LIVE_TOKEN_RATE_SAMPLE_INTERVAL_MS } from '@renderer/lib/liveTokenRate';

describe('useLiveTokenRate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null while inactive', () => {
    const { result } = renderHook(() => useLiveTokenRate(false, 0));
    expect(result.current).toBeNull();
  });

  it('clears rate when the run deactivates', () => {
    const { result, rerender } = renderHook(
      ({ active, tokens }) => useLiveTokenRate(active, tokens),
      { initialProps: { active: true, tokens: 0 } }
    );

    act(() => {
      vi.advanceTimersByTime(LIVE_TOKEN_RATE_SAMPLE_INTERVAL_MS);
    });
    rerender({ active: true, tokens: 40 });
    act(() => {
      vi.advanceTimersByTime(LIVE_TOKEN_RATE_MIN_SPAN_MS);
    });
    expect(result.current).not.toBeNull();

    rerender({ active: false, tokens: 40 });
    expect(result.current).toBeNull();
  });

  it('computes a positive rate once the window has enough span and growth', () => {
    const { result, rerender } = renderHook(
      ({ tokens }) => useLiveTokenRate(true, tokens),
      { initialProps: { tokens: 0 } }
    );

    act(() => {
      vi.advanceTimersByTime(LIVE_TOKEN_RATE_SAMPLE_INTERVAL_MS);
    });
    rerender({ tokens: 50 });
    act(() => {
      vi.advanceTimersByTime(LIVE_TOKEN_RATE_MIN_SPAN_MS);
    });

    expect(result.current).not.toBeNull();
    expect(result.current!).toBeGreaterThan(0);
  });

  it('resets samples when completion tokens regress', () => {
    const { result, rerender } = renderHook(
      ({ tokens }) => useLiveTokenRate(true, tokens),
      { initialProps: { tokens: 0 } }
    );

    act(() => {
      vi.advanceTimersByTime(LIVE_TOKEN_RATE_SAMPLE_INTERVAL_MS);
    });
    rerender({ tokens: 30 });
    act(() => {
      vi.advanceTimersByTime(LIVE_TOKEN_RATE_MIN_SPAN_MS);
    });
    expect(result.current).toBeGreaterThan(0);

    rerender({ tokens: 5 });
    expect(result.current).toBeNull();
  });
});
