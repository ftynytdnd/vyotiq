/**
 * On-disk layout for the per-workspace checkpoint store.
 *
 *   <userData>/vyotiq/checkpoints/<workspaceId>/
 *     runs/<runId>.json       per-run manifest (rewind preview metadata)
 *     pending.json            legacy pending index (transcript-only rewind)
 *
 * `workspaceId` is the same id `WorkspaceEntry.id` carries — stable
 * across restarts because it lives in the settings blob.
 */

import { app } from 'electron';
import { join } from 'node:path';

/**
 * Root directory shared by every workspace's store. Internal —
 * external callers use the workspace-scoped helpers below.
 */
function checkpointsRoot(): string {
  return join(app.getPath('userData'), 'vyotiq', 'checkpoints');
}

function workspaceDir(workspaceId: string): string {
  return join(checkpointsRoot(), workspaceId);
}

export function runsDir(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'runs');
}

export function pendingFile(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'pending.json');
}

export function runManifestPath(workspaceId: string, runId: string): string {
  return join(runsDir(workspaceId), `${runId}.json`);
}

