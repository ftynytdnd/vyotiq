/**
 * Pending-change registry. One JSON file per workspace (`pending.json`)
 * keyed by conversation id. `recordChange` appends rows here for the
 * Settings → Checkpoints accept/reject UI.
 */

import { promises as fs, existsSync } from 'node:fs';
import type { PendingChange } from '@shared/types/checkpoint.js';
import { pendingFile } from './paths.js';
import { logger } from '../logging/logger.js';
import { atomicWriteJson } from './atomicWrite.js';

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
  await atomicWriteJson(pendingFile(workspaceId), bucket);
}

/** List pending changes for a conversation. */
export async function listForConversation(
  conversationId: string,
  knownWorkspaceIds: readonly string[]
): Promise<PendingChange[]> {
  // Load every workspace bucket the caller cares about and concat
  // matching entries. Callers supply the workspace id set so we don't
  // need to walk the disk for every conversation.
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

/** Drain every in-flight write chain. Called from app `before-quit`. */
export async function flushAll(): Promise<void> {
  await Promise.all(Array.from(writeChains.values()));
}

/**
 * Move every pending row for a conversation from one workspace bucket to
 * another (conversation reparent). No-op when the source bucket is empty.
 */
export async function migrateConversationPending(
  conversationId: string,
  fromWorkspaceId: string,
  toWorkspaceId: string
): Promise<void> {
  if (fromWorkspaceId === toWorkspaceId) return;
  const fromBucket = await loadBucket(fromWorkspaceId);
  const list = fromBucket[conversationId];
  if (!list || list.length === 0) return;
  delete fromBucket[conversationId];
  cache.set(fromWorkspaceId, fromBucket);
  await serialize(fromWorkspaceId, () => persistBucket(fromWorkspaceId, fromBucket));

  const toBucket = await loadBucket(toWorkspaceId);
  const migrated = list.map((p) => ({ ...p, workspaceId: toWorkspaceId }));
  const existing = toBucket[conversationId] ?? [];
  toBucket[conversationId] = [...existing, ...migrated];
  cache.set(toWorkspaceId, toBucket);
  await serialize(toWorkspaceId, () => persistBucket(toWorkspaceId, toBucket));
  log.info('migrated pending rows on conversation move', {
    conversationId,
    fromWorkspaceId,
    toWorkspaceId,
    count: migrated.length
  });
}

/** Append a pending row for a conversation. */
export async function addPending(change: PendingChange): Promise<void> {
  const bucket = await loadBucket(change.workspaceId);
  const list = bucket[change.conversationId] ?? [];
  list.push(change);
  bucket[change.conversationId] = list;
  cache.set(change.workspaceId, bucket);
  await serialize(change.workspaceId, () => persistBucket(change.workspaceId, bucket));
}

/** Drop one pending row by entry id across workspace buckets. */
export async function dropByEntryId(
  entryId: string,
  knownWorkspaceIds?: readonly string[]
): Promise<{ workspaceId: string; change: PendingChange } | null> {
  const ids = knownWorkspaceIds ?? Array.from(cache.keys());
  for (const wsId of ids) {
    const bucket = await loadBucket(wsId);
    for (const [conversationId, list] of Object.entries(bucket)) {
      const idx = list.findIndex((p) => p.entryId === entryId);
      if (idx >= 0) {
        const [removed] = list.splice(idx, 1);
        if (list.length === 0) delete bucket[conversationId];
        cache.set(wsId, bucket);
        await serialize(wsId, () => persistBucket(wsId, bucket));
        return { workspaceId: wsId, change: removed! };
      }
    }
  }
  return null;
}

/** Drop one pending row when workspace + conversation + entry are known. */
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
  if (list.length === 0) delete bucket[conversationId];
  await serialize(workspaceId, () => persistBucket(workspaceId, bucket));
  return true;
}

/** Drop every pending row for a conversation across known workspace buckets. */
export async function dropAllForConversation(
  conversationId: string,
  knownWorkspaceIds?: readonly string[]
): Promise<number> {
  const ids =
    knownWorkspaceIds ??
    Array.from(cache.keys());
  let count = 0;
  for (const wsId of ids) {
    const bucket = await loadBucket(wsId);
    const list = bucket[conversationId];
    if (!list || list.length === 0) continue;
    count += list.length;
    delete bucket[conversationId];
    await serialize(wsId, () => persistBucket(wsId, bucket));
  }
  return count;
}

/** Drop pending rows whose runId is in the given set. */
export async function dropPendingForRuns(
  workspaceId: string,
  runIds: ReadonlySet<string>
): Promise<number> {
  const bucket = await loadBucket(workspaceId);
  let dropped = 0;
  for (const [conversationId, list] of Object.entries(bucket)) {
    const kept = list.filter((p) => {
      if (runIds.has(p.runId)) {
        dropped++;
        return false;
      }
      return true;
    });
    if (kept.length === 0) delete bucket[conversationId];
    else bucket[conversationId] = kept;
  }
  if (dropped > 0) {
    await serialize(workspaceId, () => persistBucket(workspaceId, bucket));
  }
  return dropped;
}

