/**
 * `blob.ts` cache + persistence tests. The Phase-1 fix here was the
 * cache-rollback behavior on a failed disk write: the in-memory blob
 * must NOT advertise state that never reached disk, AND the rollback
 * must NOT clobber a later-queued write that did succeed.
 *
 * `safeStore` is mocked at the module level so each test fully
 * controls disk-write outcomes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/secrets/safeStore', async () => {
  let store: Record<string, unknown> = {};
  let writeShouldThrow = false;
  return {
    readPlainJson: vi.fn(async (file: string) => store[file] ?? null),
    writePlainJson: vi.fn(async (file: string, data: unknown) => {
      if (writeShouldThrow) {
        writeShouldThrow = false;
        throw new Error('disk failure');
      }
      store[file] = data;
    }),
    writeEncryptedJson: vi.fn(),
    readEncryptedJson: vi.fn(async () => null),
    __setWriteShouldThrow: (v: boolean) => {
      writeShouldThrow = v;
    },
    __reset: () => {
      store = {};
      writeShouldThrow = false;
    }
  };
});

import * as safeStore from '@main/secrets/safeStore';

beforeEach(async () => {
  // Force a fresh module per test so the in-memory `cache` resets.
  vi.resetModules();
  (safeStore as unknown as { __reset: () => void }).__reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateBlob', () => {
  it('persists a mutated value and surfaces it on subsequent reads', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const { updateBlob, readBlob } = await import('@main/settings/blob');
    const result = await updateBlob((cur) => ({ ...cur, workspacePath: '/ws/a' }));
    expect(result.workspacePath).toBe('/ws/a');
    const round = await readBlob();
    expect(round.workspacePath).toBe('/ws/a');
  });

  it('rolls back the in-memory cache when the disk write fails', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const { updateBlob, readBlob } = await import('@main/settings/blob');
    // Seed a known-good value.
    await updateBlob((cur) => ({ ...cur, workspacePath: '/ws/seed' }));
    // Arm the next write to throw.
    (safeStore as unknown as { __setWriteShouldThrow: (v: boolean) => void }).__setWriteShouldThrow(true);
    await updateBlob((cur) => ({ ...cur, workspacePath: '/ws/UNREACHABLE' }));
    const round = await readBlob();
    // The failing write must NOT advertise its uncommitted value.
    expect(round.workspacePath).toBe('/ws/seed');
  });

  it('does NOT roll back when a later successful write has advanced the cache', async () => {
    vi.doMock('@main/secrets/safeStore', () => safeStore);
    const { updateBlob, readBlob } = await import('@main/settings/blob');
    // First write fails, but before the rollback can fire we queue a
    // second successful write. The serialization guarantees that by the
    // time the failing write's catch block runs, `cache !== previous`,
    // so the rollback is a no-op.
    (safeStore as unknown as { __setWriteShouldThrow: (v: boolean) => void }).__setWriteShouldThrow(true);
    const failing = updateBlob((cur) => ({ ...cur, workspacePath: '/ws/fail' }));
    const succeeding = updateBlob((cur) => ({ ...cur, workspacePath: '/ws/win' }));
    await Promise.allSettled([failing, succeeding]);
    const round = await readBlob();
    expect(round.workspacePath).toBe('/ws/win');
  });
});
