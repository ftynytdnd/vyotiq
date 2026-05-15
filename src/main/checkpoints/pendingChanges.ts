/**
 * Pending-change registry. One small JSON file per workspace
 * (`pending.json`) keyed by conversation id. Holds the entries the
 * user has not explicitly Accepted or Rejected yet.
 *
 * Auto-accept on next user prompt is implemented by the chat IPC,
 * which calls `dropAllForConversation(...)` when a fresh user-prompt
 * lands for the conversation.
 */

import { promises as fs, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { pendingFile } from './paths.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/pendingChanges');

type Bucket = Record<string, PendingChange[]>; // conversationId -> entries

// workspaceId-keyed cache + write chain.
const cache = new Map<string, Bucket>();
const writeChains = new Map<string, Promise<void>>();

function serialize(workspaceId: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(workspaceId) ?? Promise.resolve();
  const next = prev.then(fn).catch((err) =>
    log.error('pending write failed', { workspaceId, err })
  );
  writeChains.set(workspaceId, next);
  return next;
}

async function loadBucket(workspaceId: string): Promise<Bucket> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;
  const path = pendingFile(workspaceId);
  let bucket: Bucket = {};
  if (existsSync(path)) {
    try {
      const raw = await fs.readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as Bucket;
      if (parsed && typeof parsed === 'object') bucket = parsed;
    } catch (err) {
      log.warn('pending.json unreadable; starting fresh', { workspaceId, err });
    }
  }
  cache.set(workspaceId, bucket);
  return bucket;
}

async function persistBucket(workspaceId: string, bucket: Bucket): Promise<void> {
  const path = pendingFile(workspaceId);
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(bucket), 'utf8');
  await fs.rename(tmp, path);
}

/** Append a pending change for a conversation. */
export async function addPending(change: PendingChange): Promise<void> {
  const bucket = await loadBucket(change.workspaceId);
  const list = bucket[change.conversationId] ?? [];
  // Defensive dedup by entryId — replay seeds + live emits both go
  // through this path on boot, so a stable id should not duplicate.
  if (list.some((p) => p.entryId === change.entryId)) return;
  list.push(change);
  bucket[change.conversationId] = list;
  cache.set(change.workspaceId, bucket);
  return serialize(change.workspaceId, () => persistBucket(change.workspaceId, bucket));
}

/** Drop one pending entry (Accept or Reject path — call sites differ). */
export async function dropOne(
  workspaceId: string,
  conversationId: string,
  entryId: string
): Promise<boolean> {
  const bucket = await loadBucket(workspaceId);
  const list = bucket[conversationId];
  if (!list) return false;
  const idx = list.findIndex((p) => p.entryId === entryId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  if (list.length === 0) {
    delete bucket[conversationId];
  } else {
    bucket[conversationId] = list;
  }
  cache.set(workspaceId, bucket);
  await serialize(workspaceId, () => persistBucket(workspaceId, bucket));
  return true;
}

/** Variant for callers that only know the entryId — scans every workspace. */
export async function dropByEntryId(entryId: string): Promise<{
  workspaceId: string;
  conversationId: string;
  change: PendingChange;
} | null> {
  for (const [workspaceId, bucket] of cache.entries()) {
    for (const [conversationId, list] of Object.entries(bucket)) {
      const idx = list.findIndex((p) => p.entryId === entryId);
      if (idx < 0) continue;
      const [removed] = list.splice(idx, 1);
      if (list.length === 0) delete bucket[conversationId];
      else bucket[conversationId] = list;
      cache.set(workspaceId, bucket);
      await serialize(workspaceId, () => persistBucket(workspaceId, bucket));
      return { workspaceId, conversationId, change: removed! };
    }
  }
  return null;
}

/**
 * Drop every pending entry under one conversation. Returns the count.
 *
 * `knownWorkspaceIds` mirrors `listForConversation`'s contract — when
 * supplied, each workspace's bucket is loaded from disk first so the
 * scan can see entries the cache has not yet promoted. Without this,
 * the auto-accept-on-next-prompt path (`chat.ipc → acceptAll`) silently
 * dropped zero entries on a cold process boot: the cache started
 * empty, so the loop walked nothing, while the on-disk
 * `pending.json` still held entries from the previous session. The
 * user then saw stale rows in the pending panel that the harness
 * promised would have been auto-accepted.
 *
 * The legacy zero-arg form is preserved for callers that genuinely
 * have no workspace list (defensive paths, future internal callers).
 * It scans only the in-memory cache, matching the pre-fix behavior.
 */
export async function dropAllForConversation(
  conversationId: string,
  knownWorkspaceIds?: readonly string[]
): Promise<number> {
  // Warm every named workspace's bucket BEFORE the scan so disk-only
  // entries land in the cache and are eligible for removal. Skipped
  // when the caller didn't supply the id list (legacy contract).
  if (knownWorkspaceIds) {
    for (const wsId of knownWorkspaceIds) {
      await loadBucket(wsId);
    }
  }
  let removed = 0;
  for (const [workspaceId, bucket] of cache.entries()) {
    const list = bucket[conversationId];
    if (!list || list.length === 0) continue;
    removed += list.length;
    delete bucket[conversationId];
    cache.set(workspaceId, bucket);
    await serialize(workspaceId, () => persistBucket(workspaceId, bucket));
  }
  return removed;
}

/** List pending changes for a conversation. */
export async function listForConversation(
  conversationId: string,
  knownWorkspaceIds: readonly string[]
): Promise<PendingChange[]> {
  // Load every workspace bucket the caller cares about and concat
  // matching entries. The caller (chat.ipc) supplies the workspace
  // id set so we don't need to walk the disk for every conversation.
  const out: PendingChange[] = [];
  for (const wsId of knownWorkspaceIds) {
    const bucket = await loadBucket(wsId);
    const list = bucket[conversationId];
    if (list) out.push(...list);
  }
  // Stable order — by createdAt asc.
  out.sort((a, b) => a.createdAt - b.createdAt);
  return out;
}

/**
 * Bulk drop every pending entry whose `runId` is in `runIds`. Used by
 * `rewindToPrompt` so a single rewind sweeps the in-memory pending
 * cache for every run that the FS revert just rolled back, in one
 * persisted write per workspace bucket.
 *
 * `knownWorkspaceIds` mirrors the `dropAllForConversation` contract:
 * each named workspace's bucket is loaded from disk first so cold-
 * cache buckets are eligible for the scan. Returns the total number
 * of removed rows.
 */
export async function dropPendingForRuns(
  runIds: readonly string[],
  knownWorkspaceIds?: readonly string[]
): Promise<number> {
  if (runIds.length === 0) return 0;
  const targets = new Set(runIds);
  if (knownWorkspaceIds) {
    for (const wsId of knownWorkspaceIds) {
      await loadBucket(wsId);
    }
  }
  let removed = 0;
  for (const [workspaceId, bucket] of cache.entries()) {
    let bucketDirty = false;
    for (const [conversationId, list] of Object.entries(bucket)) {
      const next = list.filter((p) => !targets.has(p.runId));
      if (next.length === list.length) continue;
      removed += list.length - next.length;
      bucketDirty = true;
      if (next.length === 0) delete bucket[conversationId];
      else bucket[conversationId] = next;
    }
    if (bucketDirty) {
      cache.set(workspaceId, bucket);
      await serialize(workspaceId, () => persistBucket(workspaceId, bucket));
    }
  }
  return removed;
}

/** Drain every in-flight write chain. Called from app `before-quit`. */
export async function flushAll(): Promise<void> {
  await Promise.all(Array.from(writeChains.values()));
}

/** Clear cache for a workspace (used by `prune`). */
export async function clearWorkspace(workspaceId: string): Promise<void> {
  cache.delete(workspaceId);
  try {
    await fs.unlink(pendingFile(workspaceId));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('failed to unlink pending.json on clear', { workspaceId, err });
    }
  }
}
