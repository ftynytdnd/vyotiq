/**
 * Garbage collection / prune for the checkpoint store.
 *
 * `pruneOlderThan` removes whole runs whose `startedAt` is older than
 * the cutoff. `clearWorkspace` wipes everything. Both walk the blob
 * store afterwards and remove orphan blobs no longer referenced by
 * any surviving run / file index — so disk usage actually shrinks.
 */

import { promises as fs } from 'node:fs';
import {
  listRunHeads,
  readRun,
  deleteRun
} from './runManifest.js';
import {
  listFilesWithHistory,
  readHistory,
  deleteFileIndex,
  appendRow
} from './fileIndex.js';
import { iterateBlobs, deleteBlob } from './blobStore.js';
import { workspaceDir, blobsDir, runsDir, filesDir, pendingFile } from './paths.js';
import { clearWorkspace as clearPending } from './pendingChanges.js';
import { forgetEntriesForRun, forgetEntriesForWorkspace } from './index.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/gc');

interface PruneResult {
  removedRuns: number;
  removedBlobs: number;
}

/**
 * Collect every hash currently referenced by ANY surviving run
 * manifest or file index for one workspace. Streams to an in-memory
 * Set — fine for realistic workloads (each entry is a 64-char string,
 * and the upper bound is bounded by total disk usage anyway).
 */
async function collectReferencedHashes(workspaceId: string): Promise<Set<string>> {
  const referenced = new Set<string>();
  const heads = await listRunHeads(workspaceId);
  for (const head of heads) {
    const manifest = await readRun(workspaceId, head.runId);
    if (!manifest) continue;
    for (const entry of manifest.entries) {
      if (entry.preHash) referenced.add(entry.preHash);
      if (entry.postHash) referenced.add(entry.postHash);
    }
  }
  const files = await listFilesWithHistory(workspaceId);
  for (const f of files) {
    const rows = await readHistory(workspaceId, f.filePath);
    for (const row of rows) {
      if (row.preHash) referenced.add(row.preHash);
      if (row.postHash) referenced.add(row.postHash);
    }
  }
  return referenced;
}

/** Sweep orphan blobs not present in `keep`. */
async function sweepBlobs(workspaceId: string, keep: Set<string>): Promise<number> {
  let removed = 0;
  for await (const hash of iterateBlobs(workspaceId)) {
    if (keep.has(hash)) continue;
    if (await deleteBlob(workspaceId, hash)) removed += 1;
  }
  return removed;
}

/**
 * Remove every run whose `startedAt` is older than `cutoffMs`. Also
 * removes any per-file index entries that pointed exclusively at
 * removed runs — those rows are dropped, and a file whose history
 * becomes empty has its index file unlinked too. Finally sweeps
 * orphan blobs.
 *
 * `cutoffMs = 0` removes EVERY run (caller path: "Clear all").
 */
export async function pruneOlderThan(
  workspaceId: string,
  cutoffMs: number
): Promise<PruneResult> {
  const heads = await listRunHeads(workspaceId);
  const doomedRuns = new Set(
    heads.filter((h) => h.startedAt < cutoffMs).map((h) => h.runId)
  );
  for (const runId of doomedRuns) {
    await deleteRun(workspaceId, runId);
    // Prune the in-memory entry index too. Without this, the
    // checkpoint store's `entryIndex` Map keeps stale rows pointing
    // at runs that no longer exist on disk; the next `findEntry(id)`
    // call returns a phantom location and the renderer would show
    // an unrevertable pending-changes row. Audit fix P3.
    forgetEntriesForRun(runId);
  }
  // Rewrite file indices to drop rows tied to doomed runs.
  const files = await listFilesWithHistory(workspaceId);
  for (const f of files) {
    const rows = await readHistory(workspaceId, f.filePath);
    const survivors = rows.filter((r) => !doomedRuns.has(r.runId));
    if (survivors.length === rows.length) continue;
    if (survivors.length === 0) {
      await deleteFileIndex(workspaceId, f.filePath);
      continue;
    }
    // No public "replace all rows" helper — write through the same
    // atomic appender (which serializes through the per-file write
    // chain) after wiping the old index. `appendRow` is statically
    // imported at the top of this module; there is no cycle through
    // `fileIndex.ts` so the historical dynamic-import workaround is
    // gone (it produced a vite single-chunk warning).
    await deleteFileIndex(workspaceId, f.filePath);
    for (const row of survivors) {
      await appendRow(workspaceId, f.filePath, row);
    }
  }
  const keep = await collectReferencedHashes(workspaceId);
  const removedBlobs = await sweepBlobs(workspaceId, keep);
  log.info('prune complete', {
    workspaceId,
    cutoffMs,
    removedRuns: doomedRuns.size,
    removedBlobs
  });
  return { removedRuns: doomedRuns.size, removedBlobs };
}

/** Wipe everything for one workspace. */
export async function clearAll(workspaceId: string): Promise<PruneResult> {
  const heads = await listRunHeads(workspaceId);
  const removedRuns = heads.length;
  await fs.rm(runsDir(workspaceId), { recursive: true, force: true });
  await fs.rm(filesDir(workspaceId), { recursive: true, force: true });
  // Drop every in-memory index row for this workspace alongside the
  // on-disk wipe. Audit fix P3 — same rationale as the per-run
  // `forgetEntriesForRun` call in `pruneOlderThan` above.
  forgetEntriesForWorkspace(workspaceId);
  // Count blobs before nuking the directory so the caller sees a real
  // total. Doing a fresh `iterateBlobs` after `rm` would always be 0.
  let removedBlobs = 0;
  for await (const _h of iterateBlobs(workspaceId)) removedBlobs += 1;
  await fs.rm(blobsDir(workspaceId), { recursive: true, force: true });
  await clearPending(workspaceId);
  try {
    await fs.unlink(pendingFile(workspaceId));
  } catch {
    /* noop — `clearPending` already attempted */
  }
  // Leave the workspace folder itself in place (it'll be recreated on
  // the next write) so any concurrent reads of the parent dir don't
  // race a delete-then-create.
  try {
    await fs.rm(workspaceDir(workspaceId), { recursive: true, force: true });
  } catch (err) {
    log.warn('failed to remove workspace dir after clearAll', { workspaceId, err });
  }
  return { removedRuns, removedBlobs };
}

/** Compute disk usage of one workspace's checkpoint store. */
export async function computeUsage(workspaceId: string): Promise<{
  totalBytes: number;
  blobCount: number;
  runCount: number;
  fileCount: number;
}> {
  let totalBytes = 0;
  let blobCount = 0;
  // Walk the workspace dir. `fs.stat` per file is fine for the modest
  // sizes the store reaches in practice; we don't claim sub-ms here.
  async function walk(path: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(path, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      const child = `${path}/${e.name}`;
      if (e.isDirectory()) {
        await walk(child);
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(child);
          totalBytes += st.size;
        } catch {
          /* file vanished between readdir and stat — fine */
        }
      }
    }
  }
  await walk(workspaceDir(workspaceId));
  for await (const _h of iterateBlobs(workspaceId)) blobCount += 1;
  const runHeads = await listRunHeads(workspaceId);
  const files = await listFilesWithHistory(workspaceId);
  return {
    totalBytes,
    blobCount,
    runCount: runHeads.length,
    fileCount: files.length
  };
}
