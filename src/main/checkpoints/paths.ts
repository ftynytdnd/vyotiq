/**
 * On-disk layout for the per-workspace checkpoint store.
 *
 *   <userData>/vyotiq/checkpoints/<workspaceId>/
 *     blobs/<aa>/<sha256>     content-addressed snapshot bodies
 *     runs/<runId>.json       per-run manifest
 *     pending.json            pending changes per conversation
 */

import { app } from 'electron';
import { join } from 'node:path';

function checkpointsRoot(): string {
  return join(app.getPath('userData'), 'vyotiq', 'checkpoints');
}

export function workspaceDir(workspaceId: string): string {
  return join(checkpointsRoot(), workspaceId);
}

export function blobsDir(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'blobs');
}

export function runsDir(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'runs');
}

export function pendingFile(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'pending.json');
}

export function blobPath(workspaceId: string, hash: string): string {
  const prefix = hash.slice(0, 2);
  return join(blobsDir(workspaceId), prefix, hash);
}

export function runManifestPath(workspaceId: string, runId: string): string {
  return join(runsDir(workspaceId), `${runId}.json`);
}
