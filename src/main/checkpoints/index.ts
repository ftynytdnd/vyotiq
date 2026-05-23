/**
 * Public API for the checkpoint store. Tools, the orchestrator and the
 * IPC layer import from this file — never reach into the per-concern
 * submodules directly.
 *
 * One run's lifecycle from the orchestrator's perspective:
 *
 *   const run = await openRun({...});            // on startRun
 *   ...
 *   const entry = await recordChange({...});     // per `edit`/`delete` invocation
 *   ...
 *   await finalizeRun(run.runId);                // on onDone / onError / abort
 *
 * `recordChange` does all of:
 *   1. Hash + store the pre-state + post-state blobs (deduped).
 *   2. Append an entry to the run manifest.
 *   3. Append a row to the per-file index.
 *   4. Add a pending-change registry entry.
 *   5. Forward a `checkpoint-entry` TimelineEvent through the orchestrator
 *      emitter (caller wires the emitter).
 */

import { randomUUID } from 'node:crypto';
import type {
  CheckpointEntry,
  CheckpointChangeKind,
  PendingChange
} from '@shared/types/checkpoint.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import type { DiffHunk as ToolDiffHunk } from '@shared/types/tool.js';
import { writeBlob, hashContent, readBlob } from './blobStore.js';
import {
  openRun as openRunInternal,
  appendEntry as appendRunEntry,
  finalizeRun as finalizeRunInternal,
  markEntryReverted as markRunEntryReverted,
  flushAll as flushRunManifests,
  readRun,
  listRunHeads,
  deleteRun as deleteRunManifest
} from './runManifest.js';
import {
  appendRow as appendFileRow,
  markRowReverted as markFileRowRevertedInternal,
  flushAll as flushFileIndices,
  readHistory,
  listFilesWithHistory
} from './fileIndex.js';
import {
  addPending,
  dropOne as dropOnePending,
  dropByEntryId,
  dropAllForConversation,
  dropPendingForRuns as dropPendingForRunsInternal,
  listForConversation,
  flushAll as flushPending
} from './pendingChanges.js';
import {
  revertEntryDirect,
  revertRun as revertRunInternal,
  revertFileToHash as revertFileToHashInternal
} from './revert.js';
import {
  pruneOlderThan,
  clearAll,
  computeUsage
} from './gc.js';
import { exportArchive } from './exportArchive.js';

/**
 * Minimum subset of the orchestrator's TimelineEvent emitter the
 * checkpoint store needs. Kept narrow so tests can stub a single fn.
 */
export type CheckpointEmit = (event: TimelineEvent) => void;

/**
 * In-memory `entryId → { workspaceId, runId, conversationId }` map.
 * Populated on every `recordChange` and on first `getRunManifest` per
 * (workspaceId, runId) pair. Lets `rejectEntry` / `revertEntryById`
 * resolve their owning manifest in O(1) instead of walking every
 * workspace × every run head.
 *
 * The map survives the process lifetime; on cold start the IPC
 * fallback re-scans manifests when an unknown id is requested (and
 * back-fills the index from whatever the scan resolved). Pruning a
 * workspace clears any matching entries via `forgetEntriesForRun`.
 */
const entryIndex = new Map<
  string,
  { workspaceId: string; runId: string; conversationId: string }
>();

/** Register one entry in the in-memory lookup index. */
function rememberEntry(entry: {
  id: string;
  workspaceId: string;
  runId: string;
  conversationId: string;
}): void {
  entryIndex.set(entry.id, {
    workspaceId: entry.workspaceId,
    runId: entry.runId,
    conversationId: entry.conversationId
  });
}

/** O(1) lookup. Returns `null` on a cold-cache miss; callers may fall back to a manifest scan. */
export function lookupEntryLocation(entryId: string): {
  workspaceId: string;
  runId: string;
  conversationId: string;
} | null {
  return entryIndex.get(entryId) ?? null;
}

/** Drop all index rows whose `runId` matches. Called from GC. */
export function forgetEntriesForRun(runId: string): void {
  for (const [id, loc] of entryIndex) {
    if (loc.runId === runId) entryIndex.delete(id);
  }
}

/** Drop every index row for a workspace. Called from `clearAll`. */
export function forgetEntriesForWorkspace(workspaceId: string): void {
  for (const [id, loc] of entryIndex) {
    if (loc.workspaceId === workspaceId) entryIndex.delete(id);
  }
}

/**
 * Optional broadcast hook installed once by the IPC layer at startup.
 * Lets the store push a `CHECKPOINTS_CHANGED` event into the renderer
 * whenever something the renderer might care about changed (accept,
 * reject, revert, prune, export). Kept as a setter rather than a
 * direct import to avoid an import cycle with `main/ipc/`.
 */
let broadcaster: ((workspaceId: string) => void) | null = null;

export function setCheckpointsBroadcaster(
  fn: ((workspaceId: string) => void) | null
): void {
  broadcaster = fn;
}

function broadcast(workspaceId: string): void {
  if (broadcaster) {
    try {
      broadcaster(workspaceId);
    } catch {
      /* swallow — broadcaster errors must not affect on-disk state */
    }
  }
}

/** Open / resume a run manifest. Idempotent. */
export async function openRun(opts: {
  runId: string;
  conversationId: string;
  workspaceId: string;
  label: string;
  startedAt: number;
}): Promise<void> {
  await openRunInternal(opts);
}

/** Finalize a run. Idempotent — second call is a no-op. */
export async function finalizeRun(runId: string): Promise<void> {
  await finalizeRunInternal(runId);
}

interface RecordChangeOpts {
  runId: string;
  conversationId: string;
  workspaceId: string;
  filePath: string;
  kind: CheckpointChangeKind;
  /** Body BEFORE the change. Omit for `create`. */
  preContent?: string;
  /** Body AFTER the change. Omit for `delete`. */
  postContent?: string;
  additions: number;
  deletions: number;
  hunks?: ToolDiffHunk[];
  subagentId?: string;
  /**
   * Which tool produced this entry. Used for audit + UI labelling
   * (the renderer can paint a Terminal icon for `'bash'` rows so the
   * user knows the change came through a shell command rather than
   * the `edit` / `delete` tools).
   */
  source: 'edit' | 'delete' | 'bash';
  /** Forwarded to the renderer as a synthesized TimelineEvent. */
  emit: CheckpointEmit;
}

/**
 * Record one file mutation: snapshot pre/post bodies, append entry +
 * file index row + pending entry, and emit a `checkpoint-entry` for the
 * renderer. Returns the persisted entry so the caller can inspect /
 * cite the entry id.
 */
export async function recordChange(opts: RecordChangeOpts): Promise<CheckpointEntry> {
  const entryId = randomUUID();
  const ts = Date.now();

  const preHash =
    opts.preContent !== undefined ? await writeBlob(opts.workspaceId, opts.preContent) : undefined;
  const postHash =
    opts.postContent !== undefined ? await writeBlob(opts.workspaceId, opts.postContent) : undefined;

  const entry: CheckpointEntry = {
    id: entryId,
    runId: opts.runId,
    conversationId: opts.conversationId,
    workspaceId: opts.workspaceId,
    ts,
    filePath: opts.filePath,
    kind: opts.kind,
    ...(preHash ? { preHash } : {}),
    ...(postHash ? { postHash } : {}),
    additions: opts.additions,
    deletions: opts.deletions,
    ...(opts.hunks ? { hunks: opts.hunks } : {}),
    ...(opts.subagentId ? { subagentId: opts.subagentId } : {}),
    source: opts.source
  };

  rememberEntry(entry);
  await appendRunEntry(entry);
  await appendFileRow(opts.workspaceId, opts.filePath, {
    entryId,
    runId: opts.runId,
    ts,
    kind: opts.kind,
    ...(preHash ? { preHash } : {}),
    ...(postHash ? { postHash } : {}),
    additions: opts.additions,
    deletions: opts.deletions,
    // The manifest already knows the label; we keep this slot small.
    runLabel: ''
  });

  const pending: PendingChange = {
    entryId,
    runId: opts.runId,
    conversationId: opts.conversationId,
    workspaceId: opts.workspaceId,
    filePath: opts.filePath,
    kind: opts.kind,
    ...(preHash ? { preHash } : {}),
    ...(postHash ? { postHash } : {}),
    additions: opts.additions,
    deletions: opts.deletions,
    createdAt: ts,
    ...(opts.subagentId ? { subagentId: opts.subagentId } : {}),
    source: opts.source
  };
  await addPending(pending);

  // Emit the persistent timeline event AFTER all disk writes succeed so
  // a renderer-side replay can rely on the entry being readable.
  opts.emit({
    kind: 'checkpoint-entry',
    id: entryId,
    ts,
    entryId,
    runId: opts.runId,
    conversationId: opts.conversationId,
    workspaceId: opts.workspaceId,
    filePath: opts.filePath,
    changeKind: opts.kind,
    ...(preHash ? { preHash } : {}),
    ...(postHash ? { postHash } : {}),
    additions: opts.additions,
    deletions: opts.deletions,
    source: opts.source,
    ...(opts.subagentId ? { subagentId: opts.subagentId } : {})
  });

  broadcast(opts.workspaceId);
  return entry;
}

/** Read a blob body — UTF-8 string or null. */
export const readBlobBody = readBlob;

// ---- Accept / Reject / Revert ----

/** Accept one entry: drop from pending. History unchanged. */
export async function acceptEntry(entryId: string): Promise<boolean> {
  const removed = await dropByEntryId(entryId);
  if (!removed) return false;
  broadcast(removed.workspaceId);
  return true;
}

/**
 * Strict variant of `acceptEntry` for callers that already know the
 * `(workspaceId, conversationId)` context. Routes through
 * `pendingChanges.dropOne` which validates ALL THREE keys match before
 * removing the row — defense against stale renderer state silently
 * dropping the wrong entry when ids alias across workspaces (e.g. an
 * archive import re-uses an entry id). Returns `true` on a match,
 * `false` on a guarded miss.
 */
export async function acceptEntryStrict(
  workspaceId: string,
  conversationId: string,
  entryId: string
): Promise<boolean> {
  const dropped = await dropOnePending(workspaceId, conversationId, entryId);
  if (!dropped) return false;
  broadcast(workspaceId);
  return true;
}

/**
 * Accept every pending entry for one conversation.
 *
 * `knownWorkspaceIds` is forwarded to `dropAllForConversation` so the
 * scan covers buckets the in-memory cache has not yet loaded. The
 * auto-accept-on-next-prompt path (chat.ipc) and the renderer-
 * initiated bulk-accept (checkpoints.ipc) both pass the live
 * workspace list; tests / future internal callers can omit it to
 * preserve the legacy cache-only behavior. Without the warm-up,
 * stale on-disk pending entries from a previous session survived
 * an auto-accept silently — the cache walked empty and reported 0.
 */
export async function acceptAll(
  conversationId: string,
  knownWorkspaceIds?: readonly string[]
): Promise<number> {
  const count = await dropAllForConversation(conversationId, knownWorkspaceIds);
  if (count > 0) {
    // We don't know which workspace was touched; broadcast a wildcard
    // so every renderer view refreshes. Idempotent and cheap — the
    // store-side handler fans it out to each cached workspace.
    broadcast('*');
  }
  return count;
}

/**
 * Reject one entry: revert AND drop from pending. Emits a
 * `checkpoint-revert` event so the timeline carries an audit row.
 */
export async function rejectEntry(
  entryId: string,
  emit: CheckpointEmit
): Promise<ReturnType<typeof revertEntryDirect>> {
  const removed = await dropByEntryId(entryId);
  if (!removed) {
    return { ok: false, error: { kind: 'unknown-entry', entryId } };
  }
  const manifest = await readRun(removed.workspaceId, removed.change.runId);
  const entry = manifest?.entries.find((e) => e.id === entryId);
  if (!entry) {
    return { ok: false, error: { kind: 'unknown-entry', entryId } };
  }
  const result = await revertEntryDirect(entry);
  if (result.ok && result.reverted > 0) {
    emit({
      kind: 'checkpoint-revert',
      id: randomUUID(),
      ts: Date.now(),
      entryId,
      runId: entry.runId,
      filePath: entry.filePath,
      operation: entry.kind === 'create' ? 'remove' : 'restore'
    });
  }
  broadcast(removed.workspaceId);
  return result;
}

/** Revert one entry by id (not tied to pending). */
export async function revertEntryById(
  workspaceId: string,
  runId: string,
  entryId: string,
  emit: CheckpointEmit
): Promise<ReturnType<typeof revertEntryDirect>> {
  const manifest = await readRun(workspaceId, runId);
  const entry = manifest?.entries.find((e) => e.id === entryId);
  if (!entry) {
    return { ok: false, error: { kind: 'unknown-entry', entryId } };
  }
  const result = await revertEntryDirect(entry);
  if (result.ok && result.reverted > 0) {
    emit({
      kind: 'checkpoint-revert',
      id: randomUUID(),
      ts: Date.now(),
      entryId,
      runId,
      filePath: entry.filePath,
      operation: entry.kind === 'create' ? 'remove' : 'restore'
    });
    broadcast(workspaceId);
  }
  return result;
}

/** Revert an entire run. */
export async function revertRun(
  workspaceId: string,
  runId: string,
  emit: CheckpointEmit
): Promise<ReturnType<typeof revertRunInternal>> {
  const manifest = await readRun(workspaceId, runId);
  if (!manifest) return { ok: false, error: { kind: 'unknown-run', runId } };
  const result = await revertRunInternal(workspaceId, runId);
  if (result.ok && result.reverted > 0) {
    // Emit one synthetic `checkpoint-revert` per actually-reverted
    // entry so the timeline carries a per-file audit row.
    for (const entry of manifest.entries) {
      // `manifest.entries` is still pre-revert here; the revert above
      // already flipped `reverted` on each. Surface only the rows we
      // changed in this run.
      if (entry.reverted) {
        emit({
          kind: 'checkpoint-revert',
          id: randomUUID(),
          ts: Date.now(),
          entryId: entry.id,
          runId,
          filePath: entry.filePath,
          operation: entry.kind === 'create' ? 'remove' : 'restore'
        });
      }
    }
    broadcast(workspaceId);
  }
  return result;
}

/** Revert one file to the specified content hash. */
export async function revertFileToHash(
  workspaceId: string,
  filePath: string,
  hash: string,
  emit: CheckpointEmit
): Promise<ReturnType<typeof revertFileToHashInternal>> {
  const result = await revertFileToHashInternal(workspaceId, filePath, hash);
  if (result.ok && result.reverted > 0) {
    // `runId` is omitted here — `revertFileToHash` is reached only
    // from the Checkpoints view, which has no conversation/run
    // context. The previous empty-string placeholder was a typing
    // lie (the variant now declares `runId?: string`). Review
    // finding H5.
    emit({
      kind: 'checkpoint-revert',
      id: randomUUID(),
      ts: Date.now(),
      entryId: hash,
      filePath,
      operation: 'restore'
    });
    broadcast(workspaceId);
  }
  return result;
}

// ---- Reads / Summaries ----

export async function getSummary(workspaceId: string) {
  const [runs, files, usage] = await Promise.all([
    listRunHeads(workspaceId),
    listFilesWithHistory(workspaceId),
    computeUsage(workspaceId)
  ]);
  return {
    workspaceId,
    runs,
    files,
    usage: { workspaceId, ...usage }
  };
}

/**
 * Read a run manifest and back-fill the in-memory entry index from
 * every entry it contains. Exposed as `getRunManifest` so existing
 * IPC consumers pick up the warmed cache transparently — a scan that
 * previously required a fresh file read per `rejectEntry` / `revertEntry`
 * call now warms the O(1) map as a side-effect.
 */
export async function getRunManifest(
  workspaceId: string,
  runId: string
): ReturnType<typeof readRun> {
  const manifest = await readRun(workspaceId, runId);
  if (manifest) {
    for (const e of manifest.entries) {
      rememberEntry({
        id: e.id,
        workspaceId: e.workspaceId,
        runId: e.runId,
        conversationId: e.conversationId
      });
    }
  }
  return manifest;
}
export const getFileHistory = readHistory;
export const listPending = listForConversation;

/**
 * Bulk-drop every pending entry whose `runId` is in `runIds`. Public
 * because the `rewindToPrompt` path needs to clear the pending cache
 * for every run it just rolled back without spinning a per-entry
 * `acceptEntry` loop. Returns the number of rows removed.
 */
export const dropPendingForRuns = dropPendingForRunsInternal;

// ---- Prune / Export / Flush ----

/**
 * Prune older than N days. `days <= 0` clears every run for the
 * workspace via `clearAll`. Returns `{ removedRuns, removedBlobs }`.
 */
export async function prune(
  workspaceId: string,
  days: number
): Promise<{ removedRuns: number; removedBlobs: number }> {
  let result;
  if (days <= 0) {
    result = await clearAll(workspaceId);
    // Clear the entry-lookup index for everything under this
    // workspace so a subsequent reject/revert for a stale id falls
    // through to the null-result path cleanly.
    forgetEntriesForWorkspace(workspaceId);
  } else {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    // Capture the doomed runs BEFORE pruning so we can forget their
    // entries. The GC pass below removes manifests + orphan blobs.
    const heads = await listRunHeads(workspaceId);
    const doomedRunIds = heads
      .filter((h) => h.startedAt < cutoff)
      .map((h) => h.runId);
    result = await pruneOlderThan(workspaceId, cutoff);
    for (const runId of doomedRunIds) forgetEntriesForRun(runId);
  }
  broadcast(workspaceId);
  return result;
}

export const exportArchiveForWorkspace = exportArchive;

/**
 * Delete a single run manifest + every blob it uniquely references,
 * then drop matching pending entries and forget the run from the
 * in-memory entry index. Mirrors `prune(workspaceId, days <= 0)` but
 * scoped to ONE run instead of the whole workspace — the renderer
 * Checkpoints view uses this for the per-row `Delete` affordance.
 *
 * Idempotent: deleting an unknown run is a no-op that returns
 * `{ removed: false, droppedPending: 0 }`.
 */
export async function deleteRun(
  workspaceId: string,
  runId: string
): Promise<{ removed: boolean; droppedPending: number }> {
  const manifest = await readRun(workspaceId, runId);
  if (!manifest) return { removed: false, droppedPending: 0 };

  // Drop pending rows that reference this run's entries BEFORE the
  // manifest disappears, so no orphan pending row survives the
  // deletion. We iterate the manifest entries (not pending) because
  // `pendingChanges` doesn't expose a "by runId" filter.
  let droppedPending = 0;
  for (const entry of manifest.entries) {
    const removed = await dropOnePending(
      entry.workspaceId,
      entry.conversationId,
      entry.id
    );
    if (removed) droppedPending++;
  }

  await deleteRunManifest(workspaceId, runId);
  forgetEntriesForRun(runId);
  broadcast(workspaceId);
  return { removed: true, droppedPending };
}

/**
 * SHA-256 of a UTF-8 string, exposed via the public barrel. Tests and
 * tools that need to compute the same content hash the blob store
 * uses (e.g. archive verification, content-addressed lookups) import
 * this instead of reaching into `blobStore.js`.
 */
export const computeContentHash = hashContent;

/**
 * Flip the `reverted` flag on a run-manifest entry without re-running
 * the file revert. Idempotent. Public because tools (e.g. an archive
 * importer or a manual diagnostics surface) may need to mark history
 * rows reverted after an out-of-band cleanup, while
 * `revertEntryDirect` is the canonical revert path.
 */
export const markEntryReverted = markRunEntryReverted;

/**
 * Flip the `reverted` flag on a per-file index row. Companion to
 * `markEntryReverted`; see that doc-comment for the public-API
 * rationale.
 */
export const markFileRowReverted = markFileRowRevertedInternal;

/** Drain every in-flight checkpoint write. Called from app `before-quit`. */
export async function flushAll(): Promise<void> {
  await Promise.all([
    flushRunManifests(),
    flushFileIndices(),
    flushPending()
  ]);
}

