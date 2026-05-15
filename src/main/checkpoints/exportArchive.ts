/**
 * Export archive — writes a single self-contained JSON bundle of one
 * workspace's checkpoint store into the workspace root. Single-file
 * format keeps the export trivially copyable, zero dependencies, and
 * easy to import later if we ever add an import path.
 *
 * Bundle shape:
 *   {
 *     version: 1,
 *     workspaceId, exportedAt,
 *     runs:     CheckpointRunManifest[],
 *     files:    Record<filePath, FileHistoryRow[]>,
 *     pending:  Record<conversationId, PendingChange[]>,
 *     blobs:    Record<hash, base64>   // referenced blobs only
 *   }
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  CheckpointRunManifest,
  FileHistoryRow,
  PendingChange
} from '@shared/types/checkpoint.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { listRunHeads, readRun } from './runManifest.js';
import { listFilesWithHistory, readHistory } from './fileIndex.js';
import { pendingFile } from './paths.js';
import { readBlob } from './blobStore.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/exportArchive');

interface Bundle {
  version: 1;
  workspaceId: string;
  exportedAt: number;
  runs: CheckpointRunManifest[];
  files: Record<string, FileHistoryRow[]>;
  pending: Record<string, PendingChange[]>;
  /** base64-encoded blob bodies, keyed by hash. */
  blobs: Record<string, string>;
}

export async function exportArchive(
  workspaceId: string
): Promise<{ archivePath: string; bytes: number }> {
  const workspacePath = await requireWorkspaceById(workspaceId);

  // Gather every run manifest.
  const heads = await listRunHeads(workspaceId);
  const runs: CheckpointRunManifest[] = [];
  const referenced = new Set<string>();
  for (const h of heads) {
    const manifest = await readRun(workspaceId, h.runId);
    if (!manifest) continue;
    runs.push(manifest);
    for (const e of manifest.entries) {
      if (e.preHash) referenced.add(e.preHash);
      if (e.postHash) referenced.add(e.postHash);
    }
  }

  // Gather per-file indices.
  const fileSummaries = await listFilesWithHistory(workspaceId);
  const files: Record<string, FileHistoryRow[]> = {};
  for (const f of fileSummaries) {
    const rows = await readHistory(workspaceId, f.filePath);
    files[f.filePath] = rows;
    for (const r of rows) {
      if (r.preHash) referenced.add(r.preHash);
      if (r.postHash) referenced.add(r.postHash);
    }
  }

  // Gather pending.
  let pending: Record<string, PendingChange[]> = {};
  try {
    const raw = await fs.readFile(pendingFile(workspaceId), 'utf8');
    pending = JSON.parse(raw) as Record<string, PendingChange[]>;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('failed to read pending during export', { workspaceId, err });
    }
  }

  // Pack the referenced blobs.
  const blobs: Record<string, string> = {};
  for (const hash of referenced) {
    const body = await readBlob(workspaceId, hash);
    if (body === null) {
      log.warn('referenced blob missing during export', { workspaceId, hash });
      continue;
    }
    blobs[hash] = Buffer.from(body, 'utf8').toString('base64');
  }

  const bundle: Bundle = {
    version: 1,
    workspaceId,
    exportedAt: Date.now(),
    runs,
    files,
    pending,
    blobs
  };

  const stamp = new Date(bundle.exportedAt)
    .toISOString()
    .replace(/[:.]/g, '-');
  const archivePath = join(workspacePath, `vyotiq-checkpoints-${stamp}.json`);
  const payload = JSON.stringify(bundle);
  await fs.writeFile(archivePath, payload, 'utf8');
  log.info('checkpoint archive written', {
    workspaceId,
    archivePath,
    bytes: payload.length,
    runs: runs.length,
    blobs: Object.keys(blobs).length
  });
  return { archivePath, bytes: payload.length };
}
