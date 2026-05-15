/**
 * On-disk layout for the per-workspace checkpoint store.
 *
 *   <userData>/vyotiq/checkpoints/<workspaceId>/
 *     blobs/<aa>/<sha256>     content-addressed snapshot bodies
 *     runs/<runId>.json       per-run manifest
 *     files/<base64url>.json  per-file change index
 *     pending.json            single small file: pending changes per conv
 *
 * Two-level blob fanout (`<aa>` = first 2 hex chars of the hash) caps
 * any single dir at ~256 children for a balanced hash distribution.
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

export function workspaceDir(workspaceId: string): string {
  return join(checkpointsRoot(), workspaceId);
}

export function blobsDir(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'blobs');
}

export function runsDir(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'runs');
}

export function filesDir(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'files');
}

export function pendingFile(workspaceId: string): string {
  return join(workspaceDir(workspaceId), 'pending.json');
}

export function blobPath(workspaceId: string, hash: string): string {
  // `<aa>/<sha256>` — keep the FULL hash as the filename so a single
  // glob (`blobs/*/<hash>`) can locate any blob without iterating.
  // Two-char fanout caps `blobs/<aa>` at ~256 children for a balanced
  // sha256 distribution, well under any FS limits.
  const prefix = hash.slice(0, 2);
  return join(blobsDir(workspaceId), prefix, hash);
}

export function runManifestPath(workspaceId: string, runId: string): string {
  return join(runsDir(workspaceId), `${runId}.json`);
}

/**
 * Encode a workspace-relative file path into a filename-safe form.
 * Base64url avoids every illegal Windows/macOS char (`\`, `/`, `:`,
 * `*`, `?`, `<`, `>`, `|`, `"`) and is reversible by callers that
 * need to render the original path back. Internal — external
 * callers reach the encoded path via `fileIndexPath` below.
 */
function encodeFileKey(relPath: string): string {
  return Buffer.from(relPath, 'utf8').toString('base64url');
}

export function decodeFileKey(key: string): string {
  return Buffer.from(key, 'base64url').toString('utf8');
}

export function fileIndexPath(workspaceId: string, relPath: string): string {
  return join(filesDir(workspaceId), `${encodeFileKey(relPath)}.json`);
}
