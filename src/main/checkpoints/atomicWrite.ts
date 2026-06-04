/**
 * Atomic write helper for JSON-shaped state files under the checkpoint
 * store. Centralizes the `.tmp` rename pattern used by `runManifest`
 * and `pendingChanges`, adding two pieces of robustness
 * the per-site copies lacked:
 *
 *   1. **Bounded retry on Windows rename races.** `fs.rename(tmp, dest)`
 *      transiently fails with `EPERM` / `EBUSY` / `EACCES` when an
 *      external process (Defender, OneDrive, indexer, an editor with a
 *      file watcher) holds a brief handle on the destination. The
 *      per-site copies treated the first failure as terminal — the row
 *      was logged once and the data was lost (see `vyotiq.log` line
 *      274 in the May 16 capture for the production occurrence). We
 *      retry with exponential backoff + jitter so the transient
 *      contention window almost always clears within a few hundred
 *      milliseconds.
 *
 *   2. **`.tmp` cleanup on terminal failure.** Without this the temp
 *      file accumulates next to the canonical path and the next GC
 *      pass has to sweep it. Best-effort — if cleanup itself fails we
 *      leave the temp behind, same fallback the blob store already
 *      uses.
 *
 * Atomicity guarantees on success match the prior implementation:
 * either the canonical path holds the new bytes, or it holds the
 * previous bytes. The `.tmp` is never observable as the canonical
 * path.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

const RENAME_RETRY_ATTEMPTS = 5;
const RENAME_RETRY_BASE_MS = 25;
const RENAME_RETRY_MAX_MS = 400;

const RETRYABLE_ERRNO = new Set(['EPERM', 'EBUSY', 'EACCES']);

function isRetryableRenameError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' && RETRYABLE_ERRNO.has(code);
}

function backoffDelay(attempt: number): number {
  // attempt is 1-indexed. 25, 50, 100, 200, 400 ms with ±25 % jitter.
  const base = Math.min(RENAME_RETRY_MAX_MS, RENAME_RETRY_BASE_MS * 2 ** (attempt - 1));
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(tmp: string, dest: string): Promise<void> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= RENAME_RETRY_ATTEMPTS; attempt++) {
    try {
      await fs.rename(tmp, dest);
      return;
    } catch (err) {
      lastErr = err;
      if (!isRetryableRenameError(err) || attempt === RENAME_RETRY_ATTEMPTS) {
        throw err;
      }
      await sleep(backoffDelay(attempt));
    }
  }
  // Unreachable — the loop either returns or throws — but TS needs the
  // explicit throw so the function's return type stays `Promise<void>`.
  throw lastErr;
}

async function unlinkBestEffort(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch {
    /* leave it for GC */
  }
}

/**
 * Encode-and-write a JSON value atomically to `path`. The parent
 * directory is created if missing. On terminal failure the temp file
 * is removed best-effort and the original error is re-thrown so the
 * caller's existing logging / chain semantics are preserved.
 */
export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value), 'utf8');
    await renameWithRetry(tmp, path);
  } catch (err) {
    await unlinkBestEffort(tmp);
    throw err;
  }
}

/**
 * String-body variant. Used by callers that already have an encoded
 * body in hand (`conversationStore` snapshot, JSONL rewrites). Same
 * retry + cleanup behaviour as `atomicWriteJson`.
 */
export async function atomicWriteString(path: string, body: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  try {
    await fs.writeFile(tmp, body, 'utf8');
    await renameWithRetry(tmp, path);
  } catch (err) {
    await unlinkBestEffort(tmp);
    throw err;
  }
}

/** Test-only hook. Not exported from the package index. */
export const __testing = {
  isRetryableRenameError,
  RENAME_RETRY_ATTEMPTS
};
