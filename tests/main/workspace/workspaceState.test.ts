/**
 * `workspaceState.ts` tests. Two invariants:
 *
 *   1. Setting the workspace persists BEFORE updating in-memory cache,
 *      so a disk write failure leaves `getWorkspace()` returning the
 *      previous value (Phase-1 ordering fix).
 *   2. Setting a non-directory path is rejected with a clean error.
 *
 * `blob.ts` is mocked so updateBlob can be made to reject on demand.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@main/settings/blob', () => {
  let blob: { workspacePath?: string } = {};
  let willThrow = false;
  return {
    readBlob: vi.fn(async () => ({ ...blob })),
    updateBlob: vi.fn(async (mutator: (cur: { workspacePath?: string }) => { workspacePath?: string }) => {
      if (willThrow) {
        willThrow = false;
        throw new Error('blob disk failure');
      }
      blob = mutator(blob);
      return { ...blob };
    }),
    __setWillThrow: (v: boolean) => {
      willThrow = v;
    },
    __reset: () => {
      blob = {};
      willThrow = false;
    }
  };
});

import * as blobMock from '@main/settings/blob';

let workspaceDir: string;
let regularFile: string;

beforeEach(async () => {
  vi.resetModules();
  (blobMock as unknown as { __reset: () => void }).__reset();
  workspaceDir = await mkdtemp(join(tmpdir(), 'vyotiq-ws-state-'));
  regularFile = join(workspaceDir, 'not-a-dir.txt');
  await writeFile(regularFile, 'x', 'utf8');
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(workspaceDir, { recursive: true, force: true });
});

describe('workspaceState.setWorkspace', () => {
  it('persists the path and updates the in-memory cache', async () => {
    vi.doMock('@main/settings/blob', () => blobMock);
    const { setWorkspace, getWorkspace } = await import('@main/workspace/workspaceState');
    const info = await setWorkspace(workspaceDir);
    expect(info.path).toBe(workspaceDir);
    expect(info.label).toBeTruthy();
    const round = await getWorkspace();
    expect(round.path).toBe(workspaceDir);
  });

  it('rejects a path that is not a directory', async () => {
    vi.doMock('@main/settings/blob', () => blobMock);
    const { setWorkspace } = await import('@main/workspace/workspaceState');
    await expect(setWorkspace(regularFile)).rejects.toThrow(/Not a directory/);
  });

  it('does NOT update the cache when the persistence layer rejects', async () => {
    vi.doMock('@main/settings/blob', () => blobMock);
    const { setWorkspace, getWorkspace } = await import('@main/workspace/workspaceState');
    (blobMock as unknown as { __setWillThrow: (v: boolean) => void }).__setWillThrow(true);
    await expect(setWorkspace(workspaceDir)).rejects.toThrow(/blob disk failure/);
    const round = await getWorkspace();
    expect(round.path).toBeNull();
  });
});

describe('workspaceState.requireWorkspace', () => {
  it('throws a friendly error when no workspace is set', async () => {
    vi.doMock('@main/settings/blob', () => blobMock);
    const { requireWorkspace } = await import('@main/workspace/workspaceState');
    await expect(requireWorkspace()).rejects.toThrow(/No workspace selected/);
  });
});
