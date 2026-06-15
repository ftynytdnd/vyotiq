/**
 * `createRafBatcher` — single-frame coalescing for high-frequency
 * event streams. Covers the three contract invariants:
 *   1. Multiple `push` calls within a single drain cycle coalesce
 *      into one `flush` call carrying the full batch.
 *   2. `cancel` aborts any pending flush and drops the buffer.
 *   3. Items pushed during a flush schedule the next cycle (so a
 *      re-entrant push doesn't get lost).
 *
 * happy-dom exposes `requestAnimationFrame`, so the batcher picks
 * that path; we drive it by awaiting an actual RAF cycle. This is
 * also how the live `chatChannel` exercises the helper.
 */

import { describe, expect, it } from 'vitest';
import { createRafBatcher } from '@renderer/lib/rafBatch';

/** Resolve after the browser's next animation-frame tick. */
const nextFrame = () =>
  new Promise<void>((r) => {
    requestAnimationFrame(() => r());
  });

describe('createRafBatcher', () => {
  it('coalesces multiple pushes within a frame into one flush call', async () => {
    const flushes: number[][] = [];
    const b = createRafBatcher<number>((batch) => flushes.push(batch));
    b.push(1);
    b.push(2);
    b.push(3);
    expect(flushes.length).toBe(0); // not flushed yet — still buffered
    await nextFrame();
    expect(flushes.length).toBe(1);
    expect(flushes[0]).toEqual([1, 2, 3]);
  });

  it('schedules a fresh frame after the prior batch drained', async () => {
    const flushes: number[][] = [];
    const b = createRafBatcher<number>((batch) => flushes.push(batch));
    b.push(1);
    await nextFrame();
    b.push(2);
    b.push(3);
    await nextFrame();
    expect(flushes).toEqual([[1], [2, 3]]);
  });

  it('cancel() aborts pending flush and clears the buffer', async () => {
    const flushes: number[][] = [];
    const b = createRafBatcher<number>((batch) => flushes.push(batch));
    b.push(1);
    b.push(2);
    b.cancel();
    await nextFrame();
    expect(flushes.length).toBe(0);
    // Subsequent pushes after cancel are no-ops; the batcher stays
    // permanently disabled to match the chatChannel teardown contract.
    b.push(3);
    await nextFrame();
    expect(flushes.length).toBe(0);
  });

  it('flush() drains buffered items immediately', () => {
    const flushes: number[][] = [];
    const b = createRafBatcher<number>((batch) => flushes.push(batch));
    b.push(1);
    b.push(2);
    b.flush();
    expect(flushes).toEqual([[1, 2]]);
  });

  it('re-entrant pushes during flush schedule the next cycle', async () => {
    const flushes: number[][] = [];
    let didReentrantPush = false;
    const b = createRafBatcher<number>((batch) => {
      flushes.push(batch);
      if (!didReentrantPush) {
        didReentrantPush = true;
        b.push(99);
      }
    });
    b.push(1);
    await nextFrame();
    expect(flushes).toEqual([[1]]);
    await nextFrame();
    expect(flushes).toEqual([[1], [99]]);
  });
});
