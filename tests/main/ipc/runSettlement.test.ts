/**
 * Run settlement latch — supersede must not hang when settleRun is never called.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/logging/logger.js', () => ({
  logger: {
    child: () => ({
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn()
    })
  }
}));

import {
  armRunSettlement,
  awaitRunSettlement,
  settleRun
} from '@main/ipc/runSettlement.js';

describe('runSettlement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves immediately when no latch is armed', async () => {
    await expect(awaitRunSettlement('conv-none', 50)).resolves.toBeUndefined();
  });

  it('awaits settleRun when the latch is released normally', async () => {
    armRunSettlement('conv-1');
    const pending = awaitRunSettlement('conv-1', 5_000);
    settleRun('conv-1');
    await expect(pending).resolves.toBeUndefined();
  });

  it('force-opens the latch after the timeout when settleRun is never called', async () => {
    armRunSettlement('conv-stuck');
    const pending = awaitRunSettlement('conv-stuck', 100);
    const raced = Promise.race([
      pending,
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), 150);
      })
    ]);
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBeUndefined();
    await expect(raced).resolves.toBeUndefined();
    // Second await is a no-op — latch was deleted on timeout.
    await expect(awaitRunSettlement('conv-stuck', 50)).resolves.toBeUndefined();
  });
});
