import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { abortableSleep } from '@shared/async/abortableSleep';

describe('abortableSleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves once the delay elapses', async () => {
    let settled = false;
    const p = abortableSleep(1000).then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(settled).toBe(true);
  });

  it('rejects synchronously with AbortError when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(abortableSleep(1000, ac.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
  });

  it('rejects with AbortError and clears the timer when aborted mid-flight', async () => {
    const ac = new AbortController();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const rejected = abortableSleep(5000, ac.signal);
    ac.abort();
    await expect(rejected).rejects.toMatchObject({ name: 'AbortError' });
    expect(clearSpy).toHaveBeenCalled();
  });

  it('removes its abort listener after the timer fires (no listener leak)', async () => {
    const ac = new AbortController();
    const removeSpy = vi.spyOn(ac.signal, 'removeEventListener');
    const p = abortableSleep(200, ac.signal);
    await vi.advanceTimersByTimeAsync(200);
    await p;
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
