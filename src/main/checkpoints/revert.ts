/**
 * Revert checkpoint entries back to pre-change file state.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { CheckpointEntry, CheckpointRevertResult } from '@shared/types/checkpoint.js';
import {
  realpathInsideWorkspace,
  resolveCreateInsideWorkspace
} from '../tools/sandbox.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { readBlob } from './blobStore.js';
import { markEntryReverted as markRunEntryReverted, readRun } from './runManifest.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/revert');

async function atomicWriteFile(absPath: string, content: string): Promise<void> {
  await fs.mkdir(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, absPath);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* noop */
    }
    throw err;
  }
}

async function atomicUnlinkFile(absPath: string): Promise<void> {
  try {
    await fs.unlink(absPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw err;
  }
}

async function applyEntryReversal(
  workspacePath: string,
  entry: CheckpointEntry
): Promise<CheckpointRevertResult> {
  try {
    const abs =
      entry.kind === 'create'
        ? await resolveCreateInsideWorkspace(workspacePath, entry.filePath)
        : await realpathInsideWorkspace(workspacePath, entry.filePath);

    if (entry.kind === 'create') {
      await atomicUnlinkFile(abs);
      return { ok: true, reverted: 1 };
    }

    if (!entry.preHash) {
      return { ok: false, error: { kind: 'blob-missing', hash: '' } };
    }
    const body = await readBlob(entry.workspaceId, entry.preHash);
    if (body === null) {
      return { ok: false, error: { kind: 'blob-missing', hash: entry.preHash } };
    }
    await atomicWriteFile(abs, body);
    return { ok: true, reverted: 1 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isSandbox = err instanceof Error && err.name === 'SandboxError';
    log.error('entry reversal failed', { entryId: entry.id, err: msg });
    return {
      ok: false,
      error: isSandbox ? { kind: 'sandbox', message: msg } : { kind: 'fs', message: msg }
    };
  }
}

export async function revertEntryDirect(
  entry: CheckpointEntry
): Promise<CheckpointRevertResult> {
  if (entry.reverted) {
    return { ok: true, reverted: 0 };
  }
  let workspacePath: string;
  try {
    workspacePath = await requireWorkspaceById(entry.workspaceId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: 'sandbox', message: msg } };
  }
  const result = await applyEntryReversal(workspacePath, entry);
  if (result.ok && result.reverted > 0) {
    await markRunEntryReverted(entry.workspaceId, entry.runId, entry.id);
  }
  return result;
}

export async function revertRun(
  workspaceId: string,
  runId: string
): Promise<CheckpointRevertResult> {
  const manifest = await readRun(workspaceId, runId);
  if (!manifest) {
    return { ok: false, error: { kind: 'unknown-run', runId } };
  }
  let totalReverted = 0;
  for (let i = manifest.entries.length - 1; i >= 0; i -= 1) {
    const entry = manifest.entries[i]!;
    if (entry.reverted) continue;
    const r = await revertEntryDirect(entry);
    if (!r.ok) return r;
    totalReverted += r.reverted;
  }
  return { ok: true, reverted: totalReverted };
}
