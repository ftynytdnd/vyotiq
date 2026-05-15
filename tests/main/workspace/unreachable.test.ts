/**
 * Workspace reachability retry — pins the unreachable detection +
 * retry round-trip the multi-workspace UI depends on.
 *
 * Invariants:
 *   1. A registered workspace whose path is missing on boot stat is
 *      flagged with `unreachable: true` in `listWorkspaces()` but
 *      preserved in the registry (the renderer renders a warning chip
 *      with a retry action; the entry is never dropped).
 *   2. `retryWorkspaceReachability(id)` re-stats the path and clears
 *      the flag when the path is back, leaves it set otherwise.
 *   3. The retry call is idempotent and never throws on a reachable
 *      workspace.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@main/settings/blob', () => {
  let blob: {
    workspaces?: Array<{ id: string; path: string; label: string; addedAt: number }>;
    activeWorkspaceId?: string;
    workspacePath?: string;
  } = {};
  return {
    readBlob: vi.fn(async () => ({ ...blob })),
    updateBlob: vi.fn(
      async (
        mutator: (cur: typeof blob) => typeof blob
      ) => {
        blob = mutator(blob);
        return { ...blob };
      }
    ),
    __seed: (next: typeof blob) => {
      blob = { ...next };
    },
    __reset: () => {
      blob = {};
    }
  };
});

import * as blobMock from '@main/settings/blob';

let goodDir: string;
let goneDir: string;

beforeEach(async () => {
  vi.resetModules();
  (blobMock as unknown as { __reset: () => void }).__reset();
  goodDir = await mkdtemp(join(tmpdir(), 'vyotiq-ws-good-'));
  goneDir = await mkdtemp(join(tmpdir(), 'vyotiq-ws-gone-'));
  // Delete `goneDir` immediately so the registry entry pointing at it
  // is unreachable on first stat.
  await rm(goneDir, { recursive: true, force: true });
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(goodDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('workspaceState — unreachable detection + retry', () => {
  it('flags a missing path as unreachable on listWorkspaces, preserves the entry', async () => {
    (blobMock as unknown as { __seed: (b: object) => void }).__seed({
      workspaces: [
        { id: 'ws-good', path: goodDir, label: 'good', addedAt: 1 },
        { id: 'ws-gone', path: goneDir, label: 'gone', addedAt: 2 }
      ],
      activeWorkspaceId: 'ws-good'
    });

    const { listWorkspaces } = await import('@main/workspace/workspaceState');
    const state = await listWorkspaces();

    expect(state.workspaces).toHaveLength(2);
    const good = state.workspaces.find((w) => w.id === 'ws-good')!;
    const gone = state.workspaces.find((w) => w.id === 'ws-gone')!;
    expect(good.unreachable).toBeFalsy();
    expect(gone.unreachable).toBe(true);
    // Entry preserved (never dropped) so a retry can recover it.
    expect(gone.path).toBe(goneDir);
  });

  it('clears the unreachable flag once the path is back', async () => {
    (blobMock as unknown as { __seed: (b: object) => void }).__seed({
      workspaces: [{ id: 'ws-gone', path: goneDir, label: 'gone', addedAt: 1 }],
      activeWorkspaceId: 'ws-gone'
    });

    const { listWorkspaces, retryWorkspaceReachability } = await import(
      '@main/workspace/workspaceState'
    );

    // First load + stat — unreachable.
    let state = await listWorkspaces();
    expect(state.workspaces[0]!.unreachable).toBe(true);

    // Restore the directory to mimic the user remounting the volume.
    await mkdtemp(join(tmpdir(), 'unused-')); // ensure tmpdir exists
    const fs = await import('node:fs/promises');
    await fs.mkdir(goneDir, { recursive: true });

    // Retry — flag should clear.
    state = await retryWorkspaceReachability('ws-gone');
    expect(state.workspaces[0]!.unreachable).toBeFalsy();

    // Cleanup.
    await rm(goneDir, { recursive: true, force: true });
  });

  it('keeps the flag when the path is still missing on retry, idempotent', async () => {
    (blobMock as unknown as { __seed: (b: object) => void }).__seed({
      workspaces: [{ id: 'ws-gone', path: goneDir, label: 'gone', addedAt: 1 }],
      activeWorkspaceId: 'ws-gone'
    });

    const { retryWorkspaceReachability } = await import('@main/workspace/workspaceState');

    // Path is still gone; retry must keep the flag and never throw.
    const after1 = await retryWorkspaceReachability('ws-gone');
    expect(after1.workspaces[0]!.unreachable).toBe(true);

    // Idempotent — second retry behaves identically.
    const after2 = await retryWorkspaceReachability('ws-gone');
    expect(after2.workspaces[0]!.unreachable).toBe(true);
  });

  it('rejects a retry against an unknown workspace id', async () => {
    (blobMock as unknown as { __seed: (b: object) => void }).__seed({
      workspaces: [{ id: 'ws-good', path: goodDir, label: 'good', addedAt: 1 }],
      activeWorkspaceId: 'ws-good'
    });

    const { retryWorkspaceReachability } = await import('@main/workspace/workspaceState');

    await expect(retryWorkspaceReachability('ws-nope')).rejects.toThrow(/Unknown workspace id/);
  });
});
