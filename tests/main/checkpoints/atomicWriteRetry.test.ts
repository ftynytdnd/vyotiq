/**
 * Pure-helper tests for the retry surface exposed through
 * `__testing` on `src/main/checkpoints/atomicWrite.ts`.
 *
 * The retry logic itself is exercised via the integration paths
 * (`fileIndex`, `runManifest`, `pendingChanges`, and now the
 * conversation store flush + truncate). These tests pin the
 * predicate behaviour at the lowest layer so a future contributor
 * can't quietly broaden / narrow the retryable error set.
 */

import { describe, expect, it } from 'vitest';
import { __testing } from '@main/checkpoints/atomicWrite';

const { isRetryableRenameError, RENAME_RETRY_ATTEMPTS } = __testing;

describe('isRetryableRenameError', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'])(
    'treats `%s` (typical Windows rename race) as retryable',
    (code) => {
      const err: NodeJS.ErrnoException = Object.assign(new Error('e'), { code });
      expect(isRetryableRenameError(err)).toBe(true);
    }
  );

  it.each(['ENOENT', 'EEXIST', 'ENOSPC', 'EXDEV'])(
    'does NOT retry on `%s` — these are real failures, not transient contention',
    (code) => {
      const err: NodeJS.ErrnoException = Object.assign(new Error('e'), { code });
      expect(isRetryableRenameError(err)).toBe(false);
    }
  );

  it('returns false for non-Error / null / undefined inputs', () => {
    expect(isRetryableRenameError(null)).toBe(false);
    expect(isRetryableRenameError(undefined)).toBe(false);
    expect(isRetryableRenameError('EBUSY')).toBe(false);
    expect(isRetryableRenameError({})).toBe(false);
  });
});

describe('RENAME_RETRY_ATTEMPTS', () => {
  it('exposes a small, bounded attempt count', () => {
    // The constant pins the worst-case latency: 25 + 50 + 100 + 200
    // + 400 ≈ 775 ms with no jitter — bounded enough that a
    // production call never appears hung.
    expect(RENAME_RETRY_ATTEMPTS).toBeGreaterThan(1);
    expect(RENAME_RETRY_ATTEMPTS).toBeLessThanOrEqual(8);
  });
});
