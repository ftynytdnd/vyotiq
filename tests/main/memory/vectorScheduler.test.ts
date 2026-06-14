/**
 * Vector index scheduler — serialized per-workspace runs + safe db reset.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { WORKSPACE_DOTDIR, MEMORY_SUBDIR } from '@shared/constants';
import {
  forceReindexWorkspace,
  runWorkspaceVectorIndex
} from '@main/memory/vector/indexScheduler';
import { closeAllVectorDbs } from '@main/memory/vector/vectorDb';

let workspacePath: string | null = null;

afterEach(async () => {
  if (!workspacePath) return;
  const doomed = workspacePath;
  workspacePath = null;
  closeAllVectorDbs();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(doomed, { recursive: true, force: true });
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EBUSY' && code !== 'EPERM') throw err;
      await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
    }
  }
});

async function seedWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'vyotiq-vec-sched-'));
  const memDir = join(root, WORKSPACE_DOTDIR, MEMORY_SUBDIR);
  await mkdir(memDir, { recursive: true });
  await writeFile(join(memDir, 'note.md'), '# Note\nscheduler serialization test\n', 'utf8');
  return root;
}

describe('vector index scheduler', () => {
  it('serializes overlapping runs without closing the db under an active borrower', async () => {
    workspacePath = await seedWorkspace();

    const first = runWorkspaceVectorIndex(workspacePath);
    const second = runWorkspaceVectorIndex(workspacePath);

    const [a, b] = await Promise.all([first, second]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((a?.chunksWritten ?? 0) + (b?.chunksWritten ?? 0)).toBeGreaterThan(0);
  });

  it('force reindex waits for an in-flight pass before resetting the db', async () => {
    workspacePath = await seedWorkspace();

    const inFlight = runWorkspaceVectorIndex(workspacePath);
    const forced = forceReindexWorkspace(workspacePath);

    const [background, rebuilt] = await Promise.all([inFlight, forced]);
    expect(background).not.toBeNull();
    expect(rebuilt).not.toBeNull();
    expect(rebuilt?.chunksWritten).toBeGreaterThan(0);
  });

  it('coalesces duplicate force reindex requests into one reset + rebuild', async () => {
    workspacePath = await seedWorkspace();

    const a = forceReindexWorkspace(workspacePath);
    const b = forceReindexWorkspace(workspacePath);

    expect(a).toBe(b);

    const [first, second] = await Promise.all([a, b]);
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.chunksWritten).toBeGreaterThan(0);
  });
});
