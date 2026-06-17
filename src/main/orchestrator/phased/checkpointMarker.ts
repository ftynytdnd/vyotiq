/**
 * CHECKPOINT phase — record manifest head as restore marker.
 */

import { randomUUID } from 'node:crypto';
import { flushAll as flushCheckpoints } from '../../checkpoints/index.js';
import { readRun } from '../../checkpoints/runManifest.js';
import type { CheckpointMarkerRef } from '@shared/types/phased.js';
import { revertEntryDirect } from '../../checkpoints/revert.js';

export async function recordCheckpointMarker(
  workspaceId: string,
  runId: string
): Promise<CheckpointMarkerRef | null> {
  await flushCheckpoints();
  const manifest = await readRun(workspaceId, runId);
  if (!manifest) {
    return null;
  }
  const entryCount = manifest.entries.length;
  const last = entryCount > 0 ? manifest.entries[entryCount - 1]! : null;
  return {
    checkpointId: randomUUID(),
    lastEntryId: last?.id ?? '',
    entryCount
  };
}

export async function revertEntriesAfterMarker(
  workspaceId: string,
  runId: string,
  marker: CheckpointMarkerRef
): Promise<{ ok: true; reverted: number } | { ok: false; error: string }> {
  await flushCheckpoints();
  const manifest = await readRun(workspaceId, runId);
  if (!manifest) {
    return { ok: false, error: 'run manifest missing' };
  }
  const markerIdx =
    marker.lastEntryId.length > 0
      ? manifest.entries.findIndex((e) => e.id === marker.lastEntryId)
      : -1;
  if (marker.lastEntryId.length > 0 && markerIdx < 0) {
    return { ok: false, error: 'checkpoint marker entry pruned or missing' };
  }
  let reverted = 0;
  for (let i = manifest.entries.length - 1; i > markerIdx; i -= 1) {
    const entry = manifest.entries[i]!;
    if (entry.reverted) continue;
    const r = await revertEntryDirect(entry);
    if (!r.ok) {
      const msg =
        r.error && typeof r.error === 'object' && 'message' in r.error
          ? String((r.error as { message: string }).message)
          : 'revert failed';
      return { ok: false, error: msg };
    }
    reverted += r.reverted;
  }
  return { ok: true, reverted };
}
