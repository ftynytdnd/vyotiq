/**
 * Tests for the per-provider adaptive rate guard. Pins the contract
 * `chatClient`'s 429-handling path and the orchestrator's parallel
 * sub-agent pool rely on:
 *
 *   - `acquire` resolves immediately when no cooldown is recorded.
 *   - `markRateLimited` records a deadline; subsequent `acquire` calls
 *     for the SAME provider sleep until the deadline and never longer.
 *   - Calls for a DIFFERENT provider are unaffected.
 *   - Two `markRateLimited` calls within one window auto-escalate the
 *     attempt counter; a clean window resets it.
 *   - `markSuccess` clears the cooldown immediately.
 *   - The optional `AbortSignal` cancels an in-flight wait without
 *     leaking timers (the next `acquire` for the same provider still
 *     finds the deadline intact).
 *   - `_resetForTests` wipes all state — exercised here so the helper
 *     stops being unreferenced (knip would otherwise flag it).
 *
 * `Math.random` is stubbed to `0` throughout so the jitter component
 * of `computeBackoff` is deterministic. The wall-clock backoff for
 * attempt=N is therefore exactly `min(MAX_BACKOFF_MS,
 * BASE_BACKOFF_MS * 2^N)`.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS } from '@shared/constants';
import {
  acquire,
  markRateLimited,
  markSuccess,
  _resetForTests
} from '@main/providers/providerRateGuard';

beforeEach(() => {
  vi.useFakeTimers();
  // Zero out the jitter so backoff math is predictable.
  vi.spyOn(Math, 'random').mockReturnValue(0);
  _resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const PROVIDER_A = 'provider-a';
const PROVIDER_B = 'provider-b';

/**
 * Deterministic backoff for a given attempt — mirrors the (private)
 * `computeBackoff` formula. With `Math.random` stubbed to 0 the jitter
 * term vanishes and the result is exact.
 */
function backoffFor(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, attempt));
}

describe('providerRateGuard', () => {
  it('acquire resolves immediately with no recorded cooldown', async () => {
    await expect(acquire(PROVIDER_A)).resolves.toBeUndefined();
  });

  it('acquire sleeps until the recorded deadline and then resolves', async () => {
    markRateLimited(PROVIDER_A, 1);
    const wait = backoffFor(1);

    let resolved = false;
    const p = acquire(PROVIDER_A).then(() => {
      resolved = true;
    });

    // One tick before the deadline: still pending.
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(resolved).toBe(false);

    // Cross the deadline: resolves on the next microtask.
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toBe(true);
  });

  it('acquire is unaffected by a cooldown on a DIFFERENT provider', async () => {
    markRateLimited(PROVIDER_A, 4); // long cooldown on A
    // B has no cooldown — should resolve immediately on the same tick.
    await expect(acquire(PROVIDER_B)).resolves.toBeUndefined();
  });

  it('markSuccess clears the cooldown so the next acquire is instant', async () => {
    markRateLimited(PROVIDER_A, 3);
    markSuccess(PROVIDER_A);
    await expect(acquire(PROVIDER_A)).resolves.toBeUndefined();
  });

  it('a stale (already-expired) cooldown is auto-pruned by acquire', async () => {
    markRateLimited(PROVIDER_A, 1);
    // Skip past the deadline without anyone calling acquire.
    vi.advanceTimersByTime(backoffFor(1) + 1);
    await expect(acquire(PROVIDER_A)).resolves.toBeUndefined();
  });

  it('clamps backoff at MAX_BACKOFF_MS for high attempt counts', async () => {
    // Attempt large enough that the raw exponential exceeds the cap.
    markRateLimited(PROVIDER_A, 20);
    let resolved = false;
    const p = acquire(PROVIDER_A).then(() => {
      resolved = true;
    });
    // Advance to just before the cap — still pending.
    await vi.advanceTimersByTimeAsync(MAX_BACKOFF_MS - 1);
    expect(resolved).toBe(false);
    // Crossing the cap unblocks.
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toBe(true);
  });

  it('two markRateLimited calls within one window auto-escalate the attempt', async () => {
    // First mark with no explicit attempt → attempt=1, deadline = now + backoffFor(1).
    markRateLimited(PROVIDER_A);
    // Second mark while still in the window → attempt auto-bumps to 2.
    markRateLimited(PROVIDER_A);

    let resolved = false;
    const p = acquire(PROVIDER_A).then(() => {
      resolved = true;
    });

    // Should sleep at least up to backoffFor(2) (the escalated value).
    // We cannot directly observe `lastAttempt`, but we CAN observe that
    // the deadline is at least the larger of the two computed values.
    await vi.advanceTimersByTimeAsync(backoffFor(1));
    // After only the attempt-1 backoff, the escalated deadline still hasn't landed.
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(backoffFor(2) - backoffFor(1));
    await p;
    expect(resolved).toBe(true);
  });

  it('a longer existing deadline is preserved when a shorter one is computed', async () => {
    // Heavy first mark.
    markRateLimited(PROVIDER_A, 5);
    const longDeadlineMs = backoffFor(5);

    // A subsequent shorter explicit attempt must NOT shorten the deadline.
    markRateLimited(PROVIDER_A, 1);

    let resolved = false;
    const p = acquire(PROVIDER_A).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(longDeadlineMs - 1);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toBe(true);
  });

  it('aborting during a wait rejects with AbortError and does not leak the cooldown', async () => {
    markRateLimited(PROVIDER_A, 3);
    const ctrl = new AbortController();
    const p = acquire(PROVIDER_A, ctrl.signal);

    // Abort while the wait is in flight.
    queueMicrotask(() => ctrl.abort());
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });

    // Cooldown is still recorded — abort does not implicitly clear it.
    let resolved = false;
    const p2 = acquire(PROVIDER_A).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(backoffFor(3) - 1);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p2;
    expect(resolved).toBe(true);
  });

  it('an already-aborted signal causes acquire to reject without sleeping', async () => {
    markRateLimited(PROVIDER_A, 3);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(acquire(PROVIDER_A, ctrl.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
  });

  it('_resetForTests clears every recorded cooldown', async () => {
    markRateLimited(PROVIDER_A, 3);
    markRateLimited(PROVIDER_B, 5);
    _resetForTests();
    await expect(acquire(PROVIDER_A)).resolves.toBeUndefined();
    await expect(acquire(PROVIDER_B)).resolves.toBeUndefined();
  });
});
