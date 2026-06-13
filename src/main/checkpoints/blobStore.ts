/**
 * Content-addressed blob store for checkpoint pre/post file bodies.
 */

import { createHash } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { blobPath } from './paths.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/blobStore');

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function hasBlob(workspaceId: string, hash: string): boolean {
  return existsSync(blobPath(workspaceId, hash));
}

export async function readBlob(workspaceId: string, hash: string): Promise<string | null> {
  try {
    return await fs.readFile(blobPath(workspaceId, hash), 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeBlob(workspaceId: string, content: string): Promise<string> {
  const hash = hashContent(content);
  const dest = blobPath(workspaceId, hash);
  if (hasBlob(workspaceId, hash)) return hash;
  await fs.mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  try {
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, dest);
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      /* noop */
    }
    log.error('failed to write blob', { workspaceId, hash, err });
    throw err;
  }
  return hash;
}
