/**
 * `shimmerStyle` contract — the per-instance phase-offset helper used
 * by every in-flight timeline surface. Asserts:
 *
 *   - identical seeds always return the exact same offset string
 *     (essential for React's style diffing — re-renders must not churn
 *     animation timing),
 *   - different seeds produce *different* offsets often enough that
 *     concurrent shimmers visibly desync (we can't guarantee 100%
 *     uniqueness with a 1000-bucket hash, but a small representative
 *     sample of distinct ids should produce mostly-distinct buckets),
 *   - empty / nullish seeds skip the override entirely so single-
 *     instance surfaces (e.g. `LiveStatusRow`) fall back to the
 *     default 0s delay without ceremony,
 *   - every emitted offset is a valid CSS time string in the expected
 *     `[-2800ms, 0ms]` range — invalid values would silently fall back
 *     to 0 in the browser and reintroduce the lockstep behavior.
 */

import { describe, expect, it } from 'vitest';
import { shimmerStyle } from '@renderer/lib/shimmer';

const OFFSET_KEY = '--shimmer-offset';

function offsetMs(style: ReturnType<typeof shimmerStyle>): number {
  if (!style) return 0;
  const raw = (style as Record<string, unknown>)[OFFSET_KEY];
  if (typeof raw !== 'string') throw new Error('expected --shimmer-offset to be a string');
  // Format: `-<digits>ms`.
  const match = raw.match(/^-(\d+)ms$/);
  if (!match) throw new Error(`unexpected offset format: ${raw}`);
  return Number(match[1]);
}

describe('shimmerStyle', () => {
  it('returns undefined for empty or nullish seeds', () => {
    expect(shimmerStyle('')).toBeUndefined();
    expect(shimmerStyle(undefined)).toBeUndefined();
    expect(shimmerStyle(null)).toBeUndefined();
  });

  it('produces a stable offset for the same seed across calls', () => {
    const a = shimmerStyle('subagent:S1');
    const b = shimmerStyle('subagent:S1');
    expect(a).toEqual(b);
  });

  it('emits a CSS-valid negative-ms offset for any non-empty seed', () => {
    const samples = [
      'reasoning:r-1',
      'subagent:S42',
      'subagent-pill:S42',
      'subagent-task:S42',
      'tool-group:bash:0',
      'inv:read:foo.tsx:1-200',
      'thought:t1'
    ];
    for (const seed of samples) {
      const style = shimmerStyle(seed);
      const ms = offsetMs(style);
      // Cycle is 2800ms — offsets must stay strictly inside [0, 2800).
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(2800);
    }
  });

  it('produces mostly-distinct offsets for distinct seeds', () => {
    // Generate 32 unique-looking seeds and bucket them. With a 1000-
    // bucket hash, collisions are rare but possible — assert "at least
    // 90% unique" rather than 100% so the test isn't fragile to a
    // single accidental collision.
    const seeds = Array.from({ length: 32 }, (_, i) => `subagent:S-${i}-${(i * 7919).toString(36)}`);
    const offsets = new Set(seeds.map((s) => offsetMs(shimmerStyle(s))));
    expect(offsets.size).toBeGreaterThanOrEqual(Math.floor(seeds.length * 0.9));
  });

  it('quantises to whole milliseconds (no fractional offsets)', () => {
    // React skips style mutations only when the string is byte-equal,
    // so floating-point drift would cause needless re-paints. Assert
    // every offset is an integer-ms value.
    for (const seed of ['a', 'bb', 'ccc', 'longer-seed-string-here']) {
      const ms = offsetMs(shimmerStyle(seed));
      expect(Number.isInteger(ms)).toBe(true);
    }
  });
});
