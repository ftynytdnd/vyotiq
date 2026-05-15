/**
 * Revert operations. Translates a checkpoint entry / file / run back
 * to the recorded pre-state. Sandbox-checked so a tampered manifest
 * can never write outside the workspace it claims to belong to.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type {
  CheckpointEntry,
  CheckpointRevertResult
} from '@shared/types/checkpoint.js';
import {
  realpathInsideWorkspace,
  resolveCreateInsideWorkspace
} from '../tools/sandbox.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { readBlob } from './blobStore.js';
import {
  readRun,
  markEntryReverted as markEntryRevertedManifest
} from './runManifest.js';
import { markRowReverted, readHistory } from './fileIndex.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/revert');

/**
 * Atomic write of `content` to `absPath`. Same `.tmp` rename pattern as
 * the blob store — never leaves a torn write on disk.
 */
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

/**
 * Revert a single entry, no manifest / index updates. Used as the
 * shared primitive for the per-entry, per-run and per-file paths.
 */
async function applyEntryReversal(
  workspacePath: string,
  entry: CheckpointEntry
): Promise<CheckpointRevertResult> {
  try {
    // Resolve the target path inside the workspace. `create` reversal
    // = unlink — use the create-aware resolver so a non-existent
    // file's ancestor is canonicalised. `modify` / `delete` reversal
    // = rewrite — use the symlink-aware resolver against the existing
    // target (or its parent if it was deleted).
    const abs =
      entry.kind === 'create'
        ? await resolveCreateInsideWorkspace(workspacePath, entry.filePath)
        : await realpathInsideWorkspace(workspacePath, entry.filePath);
    if (entry.kind === 'create') {
      await atomicUnlinkFile(abs);
      return { ok: true, reverted: 1 };
    }
    // Modify / delete both restore the `preHash` body.
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
    // Distinguish sandbox errors so the renderer can surface a
    // dedicated message. The `SandboxError` class is exported but
    // checking the name avoids an import cycle through tools.
    const isSandbox =
      err instanceof Error && err.name === 'SandboxError';
    log.error('entry reversal failed', { entryId: entry.id, err: msg });
    return {
      ok: false,
      error: isSandbox ? { kind: 'sandbox', message: msg } : { kind: 'fs', message: msg }
    };
  }
}

/**
 * Revert one entry given the full record. Used by the IPC layer
 * after it has read the manifest. Updates both the run manifest and
 * the per-file index `reverted` flags on success.
 */
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
    await markEntryRevertedManifest(entry.workspaceId, entry.runId, entry.id);
    await markRowReverted(entry.workspaceId, entry.filePath, entry.id);
  }
  return result;
}

/**
 * Revert an entire run by walking its entries in REVERSE so a sequence
 * `create foo`, `modify foo`, `delete foo` ends up restoring `foo` to
 * its pre-run state. Stops on the first failure with a clear error.
 */
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

/**
 * Revert one file to the specified content hash by writing the blob
 * into the file's path. Used by the per-file history view.
 * Note: this does NOT mark prior entries as `reverted` — it's a
 * "restore to this version" action, not a "this specific entry was
 * undone" semantic. The user can see the audit trail via a
 * subsequent `checkpoint-revert` event we emit at the IPC layer.
 */
export async function revertFileToHash(
  workspaceId: string,
  filePath: string,
  hash: string
): Promise<CheckpointRevertResult> {
  let workspacePath: string;
  try {
    workspacePath = await requireWorkspaceById(workspaceId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: 'sandbox', message: msg } };
  }

  // Defensive audit log: surface the file's recorded history depth +
  // whether the requested hash is present anywhere in it BEFORE we
  // overwrite the on-disk contents. A revert to a hash that doesn't
  // appear in the index is legal (the renderer can pass any blob hash
  // the workspace has on disk), but it's worth flagging at debug
  // level so a support trace can distinguish "user picked a known
  // history row" from "user typed a hash that's only present because
  // a sibling tool wrote the same content earlier".
  try {
    const history = await readHistory(workspaceId, filePath);
    const matched = history.some(
      (row) => row.preHash === hash || row.postHash === hash
    );
    log.debug('revertFileToHash: pre-revert history snapshot', {
      workspaceId,
      filePath,
      hash,
      historyRows: history.length,
      hashInHistory: matched
    });
  } catch (err) {
    // History lookup is purely diagnostic; never let a read failure
    // here block the revert. The atomicWriteFile path below is the
    // single source of truth for the actual outcome.
    log.debug('revertFileToHash: pre-revert history read failed', {
      workspaceId,
      filePath,
      err
    });
  }

  const body = await readBlob(workspaceId, hash);
  if (body === null) {
    return { ok: false, error: { kind: 'blob-missing', hash } };
  }
  let abs: string;
  try {
    abs = await realpathInsideWorkspace(workspacePath, filePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isSandbox = err instanceof Error && err.name === 'SandboxError';
    return {
      ok: false,
      error: isSandbox ? { kind: 'sandbox', message: msg } : { kind: 'fs', message: msg }
    };
  }
  try {
    await atomicWriteFile(abs, body);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { kind: 'fs', message: msg } };
  }
  return { ok: true, reverted: 1 };
}

