/**
 * Content-addressed blob store.
 *
 * Every snapshot body (the pre-state / post-state of a file at the
 * moment a checkpoint entry was recorded) lives here, keyed by the
 * sha256 of the body. Two identical file contents share one blob.
 *
 * The store is INTERNAL — call sites use `recordChange` (`./index.ts`)
 * which hashes + writes via these helpers and never touches the
 * `blobs/` directory directly.
 *
 * Atomicity: every write goes through a `.tmp` sibling that is
 * `fs.rename`d into place. A crash during write leaves the `.tmp` for
 * the next GC pass and the canonical path either doesn't exist or
 * holds the previous content — never a torn write.
 */

import { createHash } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { blobPath, blobsDir } from './paths.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/blobStore');

/**
 * SHA-256 of a UTF-8 string. Stable across platforms and node versions.
 * Returned as a hex string so it round-trips through filenames cleanly.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Returns `true` when the blob for `hash` exists in `workspaceId`'s
 * store. Cheap synchronous existsSync — no race surface because the
 * caller's only legitimate next action is to skip writing.
 */
export function hasBlob(workspaceId: string, hash: string): boolean {
  return existsSync(blobPath(workspaceId, hash));
}

/**
 * Read a blob's UTF-8 body. Returns `null` when the blob is missing
 * (caller decides whether that's a real error — e.g. a stale revert
 * pointer — or expected, e.g. a `read` for a `create` entry that
 * never had a pre-state).
 */
export async function readBlob(workspaceId: string, hash: string): Promise<string | null> {
  try {
    return await fs.readFile(blobPath(workspaceId, hash), 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write a content blob, deduping by hash. Returns the hash so the
 * caller can record it in the entry manifest. Idempotent: a content
 * already on disk is a no-op (existence check + skip — saves the
 * blob-store from rewriting common contents like empty files).
 */
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
    // Clean up the temp file on failure so the next GC pass doesn't
    // have to. Best-effort — if it sticks, GC handles it.
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

/**
 * Iterate every blob hash currently on disk for one workspace. Used
 * by the GC pass to prune blobs no longer referenced by any run /
 * file index. Streaming-friendly — the caller decides what to do with
 * each yielded hash without buffering the full set.
 */
export async function* iterateBlobs(workspaceId: string): AsyncGenerator<string> {
  const root = blobsDir(workspaceId);
  let prefixes: string[];
  try {
    prefixes = await fs.readdir(root);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw err;
  }
  for (const prefix of prefixes) {
    let names: string[];
    try {
      names = await fs.readdir(`${root}/${prefix}`);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      throw err;
    }
    for (const name of names) {
      // Skip `.tmp` siblings left behind by a crashed write.
      if (name.endsWith('.tmp')) continue;
      yield name;
    }
  }
}

/**
 * Remove one blob from disk. Used by GC. Returns `true` on a real
 * unlink, `false` when the blob was already missing (race-tolerant).
 */
export async function deleteBlob(workspaceId: string, hash: string): Promise<boolean> {
  try {
    await fs.unlink(blobPath(workspaceId, hash));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw err;
  }
}
