/**
 * Conversation store. Persistent JSONL transcripts.
 *
 * Layout under `<userData>/vyotiq/conversations/`:
 *   - `<id>.jsonl`  — one TimelineEvent per line, append-only.
 *   - `index.json`  — bounded metadata array (last N conversations).
 *
 * Why JSONL:
 *   - Per-event appends are O(1) (single fs.appendFile).
 *   - Crash-safe: a torn last line is detected on parse and skipped.
 *   - Streaming reads via createReadStream + readline.
 *
 * All writes are serialized through per-conversation queues so a burst of
 * streaming-text deltas never reorders on disk.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs, createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  Conversation,
  ConversationMeta,
  TimelineEvent
} from '@shared/types/chat.js';
import { logger } from '../logging/logger.js';
import { sanitizeTitle } from './titleSanitizer.js';
import { getActiveWorkspace, listWorkspaces } from '../workspace/workspaceState.js';
import { atomicWriteString } from '../checkpoints/atomicWrite.js';
import { deleteAttachmentsForConversation } from '../attachments/gc.js';
import { normalizeLegacyTranscript } from '@shared/transcript/normalizeLegacyTranscript.js';
import { migrateConversationPending } from '../checkpoints/pendingChanges.js';

const log = logger.child('conversations');

/** Legacy context-window summarization timeline events (removed feature). */
const LEGACY_SUMMARY_EVENT_PREFIX = 'context-summary-';

function stripLegacySummaryTimelineEvents(
  events: ReadonlyArray<TimelineEvent>
): TimelineEvent[] {
  const filtered = events.filter((e) => !e.kind.startsWith(LEGACY_SUMMARY_EVENT_PREFIX));
  return filtered.length === events.length ? [...events] : filtered;
}

const ROOT_DIR = 'conversations';
const INDEX_FILE = 'index.json';
const FILE_EXT = '.jsonl';
const MAX_CONVERSATIONS = 200;
const FLUSH_INTERVAL_MS = 250;
const FLUSH_EVERY_N_EVENTS = 16;

let baseDir: string | null = null;
let indexCache: ConversationMeta[] | null = null;
let indexLoad: Promise<ConversationMeta[]> | null = null;
let indexDirty = false;
let flushTimer: NodeJS.Timeout | null = null;
let eventsSinceFlush = 0;
let writeChain: Promise<void> = Promise.resolve();
const appendChains: Map<string, Promise<void>> = new Map();
/**
 * Conversations the renderer has explicitly asked us to drop. Used to
 * defeat the race between an in-flight async `appendEvent` (queued from
 * `chat.ipc.ts:emit`) and a `conversations:remove` call: without this set
 * the appender's "auto-create on missing meta" recovery path would
 * resurrect the conversation in the dock after the user deleted it.
 *
 * Entries are timestamped and garbage-collected after `REMOVED_IDS_TTL_MS`
 * — a long session with many create/delete cycles would otherwise leak
 * an unbounded string set for the lifetime of the app. The TTL comfortably
 * outlasts the longest realistic in-flight append (streaming tool results,
 * provider retries with backoff, etc.) so the tombstone is still in place
 * when a racing event lands.
 *
 * Audit fix 2026-07-P2-1: bumped from 60 s to 5 minutes to cover the
 * worst-case in-flight chain (bash 30 s × 3 retries × `MAX_BACKOFF_MS`
 * headroom across long runs). At 60 s a
 * very long-running tool call could outlive the tombstone, race
 * `removeConversation`, and resurrect the deleted conversation via
 * the `appendEvent` auto-recovery branch. `removeConversation` also
 * RE-STAMPS the tombstone after draining the appendChain so the TTL
 * clock starts at the moment we know no in-flight append can land
 * — defense in depth on top of the bumped TTL.
 */
const REMOVED_IDS_TTL_MS = 5 * 60_000;
const removedIds = new Map<string, number>();

/**
 * Optional hook injected from the orchestrator at module init that
 * aborts every in-flight run bound to the given conversation /
 * workspace. Kept as injectable callbacks (rather than a direct
 * import of `AgentV.ts`) to avoid a cycle: `AgentV` already depends
 * on this module via `findActiveRunForConversation`'s callers in
 * `chat.ipc.ts`. The orchestrator wires this once at boot via
 * `setRunAbortHooks`; tests that don't exercise the orchestrator
 * leave the hooks unset and the store falls back to a no-op (existing
 * behaviour).
 */
let abortRunsForConversationHook: ((conversationId: string) => number) | null = null;
let abortRunsForWorkspaceHook: ((workspaceId: string) => number) | null = null;

export function setRunAbortHooks(hooks: {
  abortRunsForConversation: (conversationId: string) => number;
  abortRunsForWorkspace: (workspaceId: string) => number;
}): void {
  abortRunsForConversationHook = hooks.abortRunsForConversation;
  abortRunsForWorkspaceHook = hooks.abortRunsForWorkspace;
}

function isRecentlyRemoved(id: string): boolean {
  const ts = removedIds.get(id);
  if (ts === undefined) return false;
  if (Date.now() - ts > REMOVED_IDS_TTL_MS) {
    removedIds.delete(id);
    return false;
  }
  return true;
}

function pruneRemovedIds(): void {
  const cutoff = Date.now() - REMOVED_IDS_TTL_MS;
  for (const [id, ts] of removedIds) {
    if (ts < cutoff) removedIds.delete(id);
  }
}

function resolveBase(): string {
  if (!baseDir) {
    baseDir = join(app.getPath('userData'), 'vyotiq', ROOT_DIR);
  }
  return baseDir;
}

function transcriptPath(id: string): string {
  return join(resolveBase(), `${id}${FILE_EXT}`);
}

function indexPath(): string {
  return join(resolveBase(), INDEX_FILE);
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(resolveBase(), { recursive: true });
}

async function loadIndex(): Promise<ConversationMeta[]> {
  if (indexCache) return indexCache;
  if (indexLoad) return indexLoad;
  indexLoad = (async () => {
    try {
      await ensureDir();
      const raw = await fs.readFile(indexPath(), 'utf8');
      const parsed = JSON.parse(raw) as ConversationMeta[];
      indexCache = Array.isArray(parsed) ? parsed : [];
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        indexCache = [];
      } else {
        // Quarantine-rename the unreadable file BEFORE accepting the
        // empty fallback. Otherwise the next `flushIndex` would write
        // `[]` over the (potentially recoverable) corrupt payload and
        // permanently erase the user's conversation history. Keeping
        // the quarantine copy preserves the raw JSONL transcripts the
        // user can still salvage manually, and gives support a file to
        // diff against on bug reports.
        const corrupt = indexPath() + `.corrupt-${Date.now()}`;
        try {
          await fs.rename(indexPath(), corrupt);
          log.error(
            'conversations index unreadable; quarantined and starting empty',
            { err, corruptPath: corrupt }
          );
        } catch (renameErr: unknown) {
          // If the rename itself fails (e.g. EBUSY on Windows), fall
          // back to NOT overwriting — subsequent `flushIndex` calls are
          // still dirty-gated, but we at least log the double failure.
          log.error(
            'conversations index unreadable AND quarantine rename failed; refusing to overwrite',
            { err, renameErr }
          );
        }
        indexCache = [];
      }
    }
    await migrateWorkspaceIdsInPlace();
    return indexCache!;
  })();
  return indexLoad;
}

/**
 * Stamp every meta missing a `workspaceId` with the legacy / active
 * workspace id, scheduling a single flush at the end. Pre-multi-
 * workspace `index.json` blobs have no `workspaceId` field; without
 * this migration the new dock tree wouldn't know where to nest
 * them and `recall` / `<prior_conversations>` filtering would break.
 *
 * Idempotent: when every meta is already stamped, this is a no-op
 * with zero disk writes (it never sets `indexDirty`).
 *
 * The transcript JSONL files are NEVER rewritten — the migration is
 * purely an in-memory + `index.json` index update.
 */
async function migrateWorkspaceIdsInPlace(): Promise<void> {
  const list = indexCache;
  if (!list || list.length === 0) return;
  const needs = list.filter((m) => typeof m.workspaceId !== 'string' || m.workspaceId.length === 0);
  if (needs.length === 0) return;
  // Resolve a target workspace id. Prefer the active workspace; fall
  // back to the first registered entry; if there are NONE (fresh app),
  // we leave the metas unstamped — the next `createConversation` call
  // will fail visibly, which is the correct UX (the user must pick a
  // workspace first).
  let targetWorkspaceId: string | undefined;
  try {
    const active = await getActiveWorkspace();
    if (active) {
      targetWorkspaceId = active.id;
    } else {
      const all = await listWorkspaces();
      targetWorkspaceId = all.workspaces[0]?.id;
    }
  } catch (err) {
    log.warn('workspace lookup failed during conversation migration', { err });
  }
  if (!targetWorkspaceId) {
    log.warn(
      'cannot migrate conversation metas: no workspace registered yet. ' +
      'Metas will be stamped on next conversation create / list.',
      { unmigrated: needs.length }
    );
    return;
  }
  for (const m of needs) {
    m.workspaceId = targetWorkspaceId;
  }
  log.info('migrated conversation metas to multi-workspace registry', {
    migrated: needs.length,
    workspaceId: targetWorkspaceId
  });
  scheduleIndexFlush();
}

function scheduleIndexFlush(): void {
  indexDirty = true;
  eventsSinceFlush += 1;
  if (eventsSinceFlush >= FLUSH_EVERY_N_EVENTS) {
    void flushIndex();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushIndex();
  }, FLUSH_INTERVAL_MS);
}

async function flushIndex(): Promise<void> {
  if (!indexDirty || !indexCache) return;
  indexDirty = false;
  eventsSinceFlush = 0;
  const snapshot = JSON.stringify(indexCache);
  writeChain = writeChain.then(async () => {
    try {
      await ensureDir();
      // Shared atomic write helper — same `.tmp` rename pattern as
      // the run manifest / pending bucket, with built-in Windows-
      // EBUSY rename-retry that the old inline implementation
      // lacked.
      await atomicWriteString(indexPath(), snapshot);
    } catch (err) {
      // Re-arm the dirty flag so the next event-driven schedule (or
      // the next debounce tick) retries the write. Without this,
      // `indexDirty` would stay `false` after a transient EBUSY /
      // ENOSPC and the in-memory cache would silently diverge from
      // disk until the next mutation flipped the flag again. Review
      // finding L3.
      indexDirty = true;
      log.error('failed to flush conversations index; re-armed dirty flag', {
        err: err instanceof Error ? err.message : String(err)
      });
    }
  });
  await writeChain;
}

function findMeta(id: string): ConversationMeta | undefined {
  return (indexCache ?? []).find((m) => m.id === id);
}

function bumpMeta(meta: ConversationMeta): void {
  meta.updatedAt = Date.now();
  meta.eventCount += 1;
  const list = indexCache!;
  const idx = list.findIndex((m) => m.id === meta.id);
  if (idx >= 0) {
    list.splice(idx, 1);
    list.unshift(meta);
  }
}

async function pruneIfOversized(): Promise<void> {
  const list = indexCache!;
  while (list.length > MAX_CONVERSATIONS) {
    const oldest = list.pop();
    if (!oldest) break;
    log.info('pruning oldest conversation', { id: oldest.id, title: oldest.title });
    // Drain any in-flight appends to this transcript before unlinking, so
    // we can't race a queued write that re-creates the file post-unlink.
    const chain = appendChains.get(oldest.id);
    if (chain) {
      try {
        await chain;
      } catch {
        /* logged inside the appender */
      }
      appendChains.delete(oldest.id);
    }
    try {
      await fs.unlink(transcriptPath(oldest.id));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        log.warn('failed to unlink pruned transcript', { id: oldest.id, err });
      }
    }
  }
}

export async function createConversation(workspaceId: string): Promise<ConversationMeta> {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new Error('createConversation requires a workspaceId.');
  }
  await loadIndex();
  await ensureDir();
  const id = randomUUID();
  const now = Date.now();
  const meta: ConversationMeta = {
    id,
    title: 'New conversation',
    createdAt: now,
    updatedAt: now,
    eventCount: 0,
    workspaceId
  };
  // Touch the file so subsequent appends never race a missing-file create.
  await fs.writeFile(transcriptPath(id), '', 'utf8');
  indexCache!.unshift(meta);
  await pruneIfOversized();
  scheduleIndexFlush();
  await flushIndex();
  return { ...meta };
}

/**
 * List conversations. When `workspaceId` is supplied, returns only
 * conversations stamped with that id (used by the orchestrator's
 * `<prior_conversations>` envelope and the `recall` tool). Without
 * an argument, returns the full cross-workspace list — that is what
 * the renderer's dock tree groups itself.
 */
export async function listConversations(workspaceId?: string): Promise<ConversationMeta[]> {
  const all = await loadIndex();
  const filtered = typeof workspaceId === 'string'
    ? all.filter((m) => m.workspaceId === workspaceId)
    : all;
  return filtered.map((m) => ({ ...m }));
}

/**
 * Cheap by-id lookup. Returns a defensive copy of the meta or `null`
 * when the conversation isn't in the index. Used by `chat.ipc.ts` to
 * resolve a run's pinned `workspaceId` from its `conversationId`
 * without round-tripping the full list.
 */
export async function getConversationMeta(id: string): Promise<ConversationMeta | null> {
  await loadIndex();
  const meta = findMeta(id);
  return meta ? { ...meta } : null;
}

export async function setConversationArchived(
  id: string,
  archived: boolean
): Promise<ConversationMeta> {
  await loadIndex();
  const meta = findMeta(id);
  if (!meta) throw new Error(`Conversation not found: ${id}`);
  if (archived) {
    meta.archived = true;
    meta.archivedAt = Date.now();
  } else {
    delete meta.archived;
    delete meta.archivedAt;
  }
  meta.updatedAt = Date.now();
  scheduleIndexFlush();
  await flushIndex();
  return { ...meta };
}

export async function renameConversation(id: string, title: string): Promise<ConversationMeta> {
  await loadIndex();
  const meta = findMeta(id);
  if (!meta) throw new Error(`Conversation not found: ${id}`);
  meta.title = title.trim().slice(0, 200) || meta.title;
  meta.updatedAt = Date.now();
  scheduleIndexFlush();
  await flushIndex();
  return { ...meta };
}

export async function removeConversation(id: string): Promise<void> {
  await loadIndex();
  // Abort any in-flight orchestrator run pinned to this conversation
  // BEFORE the tombstone. The orchestrator's emit path falls into the
  // tombstoned branch of `appendEvent` once the abort propagates, but
  // without the explicit abort the loop would keep iterating against
  // burning provider tokens for a transcript that's
  // about to be unlinked. Returns the count for diagnostics; we don't
  // need to await any settling since `abortRun` only flips the signal.
  if (abortRunsForConversationHook) {
    const aborted = abortRunsForConversationHook(id);
    if (aborted > 0) {
      log.info('aborted in-flight runs on conversation remove', { conversationId: id, aborted });
    }
  }
  // Tombstone FIRST so any `appendEvent` racing this remove (e.g. a final
  // `chat:done` event still in flight) takes the early-return below
  // instead of auto-recovering and resurrecting the conversation. The
  // tombstone expires after `REMOVED_IDS_TTL_MS` (see `isRecentlyRemoved`)
  // so the Map can't grow unbounded across long sessions.
  removedIds.set(id, Date.now());
  pruneRemovedIds();
  // Drain any queued appends for this id BEFORE we touch the transcript
  // file. Otherwise the appender could re-create the JSONL after we've
  // unlinked it, leaving an orphaned file the index forgets about.
  const chain = appendChains.get(id);
  if (chain) {
    try {
      await chain;
    } catch {
      /* logged inside the appender */
    }
    appendChains.delete(id);
  }
  // Audit fix 2026-07-P2-1: re-stamp the tombstone after the drain.
  // The drain may have taken longer than `REMOVED_IDS_TTL_MS` (a long
  // queued tool call + retries can run minutes), so the tombstone we
  // set at the top of this function may already be expired by the
  // time we reach the actual unlink. Restamping ensures the
  // tombstone is at-least `REMOVED_IDS_TTL_MS` fresh from THIS point
  // onward — covering the post-delete window when fresh `appendEvent`
  // calls (e.g. the trailing `chat:done` from an aborted run) might
  // still land on the wire.
  removedIds.set(id, Date.now());
  pruneRemovedIds();
  const list = indexCache!;
  const idx = list.findIndex((m) => m.id === id);
  const removedMeta = idx >= 0 ? list[idx] : undefined;
  if (idx >= 0) list.splice(idx, 1);
  try {
    await fs.unlink(transcriptPath(id));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('failed to unlink transcript', { id, err });
    }
  }
  if (removedMeta?.workspaceId) {
    void deleteAttachmentsForConversation(removedMeta.workspaceId, id);
  }
  scheduleIndexFlush();
  await flushIndex();
}

/**
 * Append a single TimelineEvent to the JSONL transcript. Updates the index
 * meta with debounced flushing so streaming-text bursts don't thrash disk.
 *
 * Ordering invariant: meta is bumped (updatedAt / eventCount / head-pin)
 * ONLY after the disk append actually succeeds. Earlier versions bumped
 * before the write resolved, so a transient EBUSY would leave in-memory
 * eventCount ahead of disk and the dock would show counts that didn't
 * match a fresh reload.
 */
export async function appendEvent(id: string, event: TimelineEvent): Promise<void> {
  await loadIndex();
  // Cheap up-front tombstone check. Mirrored INSIDE the chain body
  // below so a `removeConversation` that interleaves between this
  // check and the chain registration still wins — see M4 comment.
  if (isRecentlyRemoved(id)) {
    log.debug('dropping appendEvent for removed conversation', { id, kind: event.kind });
    return;
  }

  // Per-conversation write queue. The tombstone re-check, the auto-
  // recovery branch (including its `getActiveWorkspace` await), the
  // disk write, and the meta bump all live INSIDE the chain body so
  // they observe (a) any prior in-flight append for this id, and (b)
  // any `removeConversation` tombstone that was set after the cheap
  // check at the top of this function.
  //
  // Critically, NO `await` runs between `loadIndex()` above and the
  // `appendChains.set(id, next)` below — additional yield points
  // here would let concurrent `appendEvent` calls capture stale
  // `prev` references and register their chains out of FIFO order,
  // breaking the per-conversation FIFO invariant the concurrent-runs
  // regression tests pin. The recovery-path `getActiveWorkspace`
  // call is therefore deferred into the chain body, which only runs
  // serially anyway.
  //
  // Race the inner tombstone re-check defeats (review finding M4):
  //   1. `appendEvent(id, e1)` resolves `loadIndex` + the top-level
  //      `isRecentlyRemoved` (returns false).
  //   2. The Node event loop yields. `removeConversation(id)` runs:
  //      tombstones, drains any chain (none yet), splices the meta,
  //      unlinks the JSONL.
  //   3. `appendEvent` resumes, registers a fresh chain entry,
  //      writes the JSONL — resurrecting the file the remove call
  //      just unlinked. With the inner re-check the chain body sees
  //      the tombstone and bails before touching disk.
  const prev = appendChains.get(id) ?? Promise.resolve();
  // Swallow a prior link's rejection so one failed append does not brick
  // the per-conversation queue; this caller still observes its own outcome.
  const next = prev.catch(() => undefined).then(async () => {
    // Re-check the tombstone after the chain head resolves. See the
    // race description above.
    if (isRecentlyRemoved(id)) {
      log.debug('dropping appendEvent for removed conversation (post-chain)', {
        id,
        kind: event.kind
      });
      return;
    }
    let meta = findMeta(id);
    if (!meta) {
      log.warn('append to unknown conversation; auto-creating', { id });
      let recoveryWorkspaceId: string | undefined;
      try {
        const active = await getActiveWorkspace();
        if (active) recoveryWorkspaceId = active.id;
      } catch {
        /* leave undefined — non-fatal */
      }
      meta = {
        id,
        title: 'Recovered conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        eventCount: 0,
        ...(recoveryWorkspaceId ? { workspaceId: recoveryWorkspaceId } : {})
      };
      indexCache!.unshift(meta);
    }
    try {
      await ensureDir();
      const file = transcriptPath(id);
      if (!existsSync(file)) {
        await fs.writeFile(file, '', 'utf8');
      }
      await fs.appendFile(file, JSON.stringify(event) + '\n', 'utf8');
      if (event.kind === 'token-usage') {
        const prompt = event.usage.promptTokens;
        if (typeof prompt === 'number' && prompt > 0) {
          meta.peakPromptTokens = Math.max(meta.peakPromptTokens ?? 0, prompt);
        }
      }
      bumpMeta(meta);
      scheduleIndexFlush();
    } catch (err) {
      log.error('failed to append event to transcript', { id, kind: event.kind, err });
      throw err;
    }
  });
  appendChains.set(id, next);
  await next;
}

/** Update best-effort meta about the last model used. */
export async function setLastModel(
  id: string,
  providerId: string,
  modelId: string
): Promise<void> {
  await loadIndex();
  const meta = findMeta(id);
  if (!meta) return;
  meta.lastProviderId = providerId;
  meta.lastModelId = modelId;
  scheduleIndexFlush();
}

/**
 * Awaits any in-flight append chain for the given conversation id. Exported
 * so call sites that MUST observe a durable transcript before doing
 * something visible to the user (e.g. `chat.ipc.ts` firing `CHAT_DONE`, or
 * a superseding run reading the prior transcript) can synchronise on the
 * tail without reaching into module-private state.
 *
 * Awaits the tail of the per-conversation append chain. Rejects when the
 * most recent append failed (errors are logged inside `appendEvent`).
 * Returns immediately when no chain exists for this id.
 */
export async function drainAppendChain(id: string): Promise<void> {
  const chain = appendChains.get(id);
  if (!chain) return;
  await chain;
}

/**
 * Truncate the transcript so the event whose `id` matches `fromEventId`
 * AND every event after it disappear from disk.
 *
 * Used by the inline-on-prompt Revert flow (`rewindToPrompt` in
 * `src/main/checkpoints/rewindToPrompt.ts`): clicking Revert on a
 * `user-prompt` rewinds the conversation to the moment just BEFORE
 * that prompt was sent, so the prompt event itself is the boundary
 * (excluded from the kept set).
 *
 * Atomicity: every step runs INSIDE the per-id `appendChains` queue
 * so any racing in-flight `appendEvent` either lands cleanly before
 * the truncate (and is dropped by the read pass) or after it (and
 * re-extends the file with a fresh tail). The on-disk write uses the
 * same `${path}.tmp` rename pattern as the rest of the store.
 *
 * Returns `{ removedCount, kept }` so callers can update UI state
 * (renderer event slice, dock event count) without a follow-up
 * `readTranscript`. `kept` is the number of events that survived the
 * trim; `meta.eventCount` is updated to the same number.
 *
 * Idempotent: rewinding to an unknown id (typo, already-removed
 * event) resolves to `{ removedCount: 0, kept: <unchanged> }` without
 * touching the file. Tombstoned conversations short-circuit the same
 * way `appendEvent` does so a racing `removeConversation` always
 * wins.
 */
export async function truncateTranscriptFrom(
  id: string,
  fromEventId: string
): Promise<{ removedCount: number; kept: number }> {
  await loadIndex();
  if (isRecentlyRemoved(id)) {
    log.debug('truncateTranscriptFrom: conversation tombstoned; no-op', {
      id,
      fromEventId
    });
    return { removedCount: 0, kept: 0 };
  }
  // Serialize through the per-id chain so any in-flight append
  // settles before we read+rewrite, and any subsequent append lands
  // after the rewrite has hit disk.
  let result: { removedCount: number; kept: number } = { removedCount: 0, kept: 0 };
  const prev = appendChains.get(id) ?? Promise.resolve();
  const next = prev.then(async () => {
    if (isRecentlyRemoved(id)) {
      log.debug('truncateTranscriptFrom: tombstoned post-chain; no-op', {
        id,
        fromEventId
      });
      return;
    }
    const meta = findMeta(id);
    if (!meta) {
      log.warn('truncateTranscriptFrom on unknown conversation; no-op', { id });
      return;
    }
    const file = transcriptPath(id);
    if (!existsSync(file)) {
      // Nothing to truncate — but still reset eventCount in case it
      // drifted ahead of disk through a torn write earlier.
      meta.eventCount = 0;
      meta.updatedAt = Date.now();
      scheduleIndexFlush();
      return;
    }

    // Read every event, keeping ONLY rows whose id strictly precedes
    // `fromEventId`. The boundary event itself is dropped (rewinding
    // a `user-prompt` removes the prompt + everything after it).
    const kept: TimelineEvent[] = [];
    let totalSeen = 0;
    let foundBoundary = false;
    await new Promise<void>((resolve, reject) => {
      const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }) });
      let lineNo = 0;
      rl.on('line', (line) => {
        lineNo += 1;
        if (line.length === 0) return;
        let parsed: TimelineEvent | null = null;
        try {
          parsed = JSON.parse(line) as TimelineEvent;
        } catch (err) {
          log.warn('truncateTranscriptFrom: skipping malformed line', { id, lineNo, err });
          return;
        }
        totalSeen += 1;
        if (foundBoundary) return;
        // The check is on `id` — works for every event kind (every
        // TimelineEvent variant carries `id`). Streaming-delta rows
        // share the assistantMsgId as their id; rewinding never
        // targets a delta directly so the equality match is stable.
        if (parsed.id === fromEventId) {
          foundBoundary = true;
          return;
        }
        kept.push(parsed);
      });
      rl.on('close', () => resolve());
      rl.on('error', (err) => reject(err));
    });

    if (!foundBoundary) {
      log.debug('truncateTranscriptFrom: boundary id not present; no-op', {
        id,
        fromEventId,
        totalSeen
      });
      result = { removedCount: 0, kept: totalSeen };
      return;
    }

    // Atomic rewrite via the shared `atomicWriteString` helper —
    // same `.tmp` rename pattern as the run manifest + pending
    // bucket, plus built-in Windows-EBUSY rename-retry the old
    // inline path was missing. We retain the local `log.error`
    // so the truncate failure remains distinguishable from other
    // helper consumers in the structured log stream.
    await ensureDir();
    const body = kept.length === 0 ? '' : kept.map((e) => JSON.stringify(e)).join('\n') + '\n';
    try {
      await atomicWriteString(file, body);
    } catch (err) {
      log.error('truncateTranscriptFrom: rewrite failed', { id, fromEventId, err });
      throw err;
    }

    const removedCount = totalSeen - kept.length;
    meta.eventCount = kept.length;
    meta.updatedAt = Date.now();
    const list = indexCache!;
    const idx = list.findIndex((m) => m.id === meta.id);
    if (idx > 0) {
      list.splice(idx, 1);
      list.unshift(meta);
    }
    scheduleIndexFlush();
    result = { removedCount, kept: kept.length };
  });
  appendChains.set(id, next);
  await next;
  return result;
}

/**
 * Streams events line-by-line. Malformed lines are logged and skipped so a
 * crash-truncated tail doesn't poison the rest of the transcript.
 *
 * Drains any in-flight appendChain for this id BEFORE opening the read
 * stream. Without this, a caller that just triggered appends via an
 * emitter (`chat.ipc.ts:emit`) and then immediately re-reads the
 * transcript — e.g. the next `chat:send` for the same conversation —
 * would race the fire-and-forget writes and potentially observe:
 *   (a) missing tail events entirely, or
 *   (b) a torn last line that this loop's malformed-line branch then
 *       silently skips, leaving the transcript short by one event.
 * Both manifested as "the orchestrator has no memory of the previous
 * turn". The drain makes every reader self-consistent at microsecond
 * cost on the happy path (no chain → early return).
 */
export async function readTranscript(id: string): Promise<TimelineEvent[]> {
  await loadIndex();
  await drainAppendChain(id);
  const file = transcriptPath(id);
  if (!existsSync(file)) return [];
  const out: TimelineEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }) });
    let lineNo = 0;
    rl.on('line', (line) => {
      lineNo += 1;
      if (line.length === 0) return;
      try {
        out.push(JSON.parse(line) as TimelineEvent);
      } catch (err) {
        log.warn('skipping malformed transcript line', { id, lineNo, err });
      }
    });
    rl.on('close', () => resolve());
    rl.on('error', (err) => reject(err));
  });
  const migrated = stripLegacySummaryTimelineEvents(out);
  if (migrated.length !== out.length) {
    const removed = out.length - migrated.length;
    await rewriteTranscriptEvents(id, migrated, removed);
  }
  return migrated;
}

async function rewriteTranscriptEvents(
  id: string,
  events: TimelineEvent[],
  removedCount: number
): Promise<void> {
  const prev = appendChains.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    if (isRecentlyRemoved(id)) return;
    const meta = findMeta(id);
    if (!meta) return;
    await ensureDir();
    const file = transcriptPath(id);
    const body = events.map((e) => JSON.stringify(e)).join('\n') + (events.length > 0 ? '\n' : '');
    await atomicWriteString(file, body);
    meta.eventCount = events.length;
    meta.updatedAt = Date.now();
    scheduleIndexFlush();
    log.info('migrated transcript: stripped legacy summary events', {
      id,
      removed: removedCount
    });
  });
  appendChains.set(id, next);
  await next;
}

/**
 * Highest orchestrator prompt-token count in a transcript slice.
 * Ignores duplicate `token-usage` rows when persisting (same rule as `appendEvent`).
 */
export function peakOrchestratorPromptTokens(events: TimelineEvent[]): number {
  let peak = 0;
  for (const e of events) {
    if (e.kind !== 'token-usage') continue;
    const prompt = e.usage.promptTokens;
    if (typeof prompt === 'number' && prompt > peak) peak = prompt;
  }
  return peak;
}

export async function readConversation(id: string): Promise<Conversation | null> {
  await loadIndex();
  const meta = findMeta(id);
  if (!meta) return null;
  // Normalize legacy transcript shapes on load (drops obsolete lifecycle rows,
  // strips legacy worker ids from surviving events).
  const rawEvents = await readTranscript(id);
  const events = normalizeLegacyTranscript(rawEvents);
  const peak = peakOrchestratorPromptTokens(events);
  if (peak > (meta.peakPromptTokens ?? 0)) {
    meta.peakPromptTokens = peak;
    scheduleIndexFlush();
  }
  return { ...meta, events };
}

/**
 * Move a conversation under a different workspace.
 *
 * Aborts every in-flight run pinned to this conversation BEFORE the
 * meta change. Re-pinning workspaceId mid-run would silently swap the
 * orchestrator's sandbox: tool calls would suddenly resolve under a
 * different folder than the one whose path the run pinned at start
 * (`AgentV.startRun` resolves `workspacePath` via the run's bound
 * workspace id). Aborting is the safer path — the user can retry under
 * the new workspace once the move settles.
 *
 * Idempotent: a move to the conversation's CURRENT workspace returns
 * the existing meta unchanged (no abort, no flush). Throws on unknown
 * conversation id; the IPC layer surfaces the message to the user.
 */
export async function moveConversationToWorkspace(
  id: string,
  targetWorkspaceId: string
): Promise<ConversationMeta> {
  if (typeof targetWorkspaceId !== 'string' || targetWorkspaceId.length === 0) {
    throw new Error('moveConversationToWorkspace requires a non-empty targetWorkspaceId.');
  }
  await loadIndex();
  const meta = findMeta(id);
  if (!meta) throw new Error(`Conversation not found: ${id}`);
  if (meta.workspaceId === targetWorkspaceId) {
    return { ...meta };
  }
  const wsState = await listWorkspaces();
  if (!wsState.workspaces.some((w) => w.id === targetWorkspaceId)) {
    throw new Error(`Unknown target workspace id: ${targetWorkspaceId}`);
  }
  // Abort every run pinned to this conversation so nothing keeps
  // streaming into a transcript whose workspace we're about to flip.
  // The hook is wired by `registerIpc` in production; tests that
  // exercise this without the hook simply skip the abort step.
  if (abortRunsForConversationHook) {
    const aborted = abortRunsForConversationHook(id);
    if (aborted > 0) {
      log.info('aborted in-flight runs on conversation move', { conversationId: id, aborted });
    }
  }
  // Drain any pending appends so the file system is quiescent before
  // the meta flip — keeps the index + on-disk transcript consistent
  // for any reader that snapshots immediately after the move resolves.
  const chain = appendChains.get(id);
  if (chain) {
    try {
      await chain;
    } catch {
      /* logged inside the appender */
    }
  }
  const priorWorkspaceId = meta.workspaceId;
  meta.workspaceId = targetWorkspaceId;
  meta.updatedAt = Date.now();
  if (priorWorkspaceId && priorWorkspaceId !== targetWorkspaceId) {
    await migrateConversationPending(id, priorWorkspaceId, targetWorkspaceId);
    // Legacy checkpoint/review sidecars on disk are not migrated.
  }
  log.info('conversation moved to workspace', {
    conversationId: id,
    targetWorkspaceId
  });
  scheduleIndexFlush();
  await flushIndex();
  return { ...meta };
}

/**
 * Bulk operation invoked when a workspace is removed. The caller chooses
 * between deleting every conversation under that workspace
 * (`mode: 'delete'`) or reparenting them to `targetWorkspaceId`
 * (`mode: 'reparent'`). Returns the list of conversation ids that were
 * touched so callers can update any external state (renderer slice
 * registry, etc.).
 *
 * Reparenting is intentionally idempotent — passing the same target
 * twice is safe and a no-op for already-stamped metas.
 */
export async function bulkRemoveOrReparentByWorkspace(
  workspaceId: string,
  mode: { type: 'delete' } | { type: 'reparent'; targetWorkspaceId: string }
): Promise<string[]> {
  await loadIndex();
  const list = indexCache!;
  const targets = list.filter((m) => m.workspaceId === workspaceId);
  if (targets.length === 0) return [];
  // Abort every in-flight run pinned to this workspace up-front. Both
  // `delete` and `reparent` benefit: the delete branch unlinks the
  // transcripts those runs were writing to, and the reparent branch
  // would silently move the JSONL out from under a streaming
  // orchestrator otherwise. Skipped when no hook is wired (test-only
  // configurations).
  if (abortRunsForWorkspaceHook) {
    const aborted = abortRunsForWorkspaceHook(workspaceId);
    if (aborted > 0) {
      log.info('aborted in-flight runs on workspace cascade', { workspaceId, aborted, mode: mode.type });
    }
  }
  const touchedIds: string[] = [];
  if (mode.type === 'delete') {
    for (const m of targets) {
      try {
        await removeConversation(m.id);
        touchedIds.push(m.id);
      } catch (err) {
        log.warn('failed to remove conversation during workspace cascade', { id: m.id, err });
      }
    }
    return touchedIds;
  }
  // Reparent.
  if (typeof mode.targetWorkspaceId !== 'string' || mode.targetWorkspaceId.length === 0) {
    throw new Error('reparent requires a non-empty targetWorkspaceId.');
  }
  for (const m of targets) {
    m.workspaceId = mode.targetWorkspaceId;
    m.updatedAt = Date.now();
    touchedIds.push(m.id);
  }
  if (touchedIds.length > 0) {
    scheduleIndexFlush();
    await flushIndex();
  }
  return touchedIds;
}

/** Auto-derive a short title from the first user prompt of a conversation. */
export async function deriveTitleIfFresh(id: string, prompt: string): Promise<void> {
  await loadIndex();
  const meta = findMeta(id);
  if (!meta) return;
  if (meta.title && meta.title !== 'New conversation') return;
  const sanitized = sanitizeTitle(prompt);
  if (sanitized.length === 0) return;
  meta.title = sanitized;
  scheduleIndexFlush();
}

/** Final flush at app quit — best-effort.
 *
 * Loops until the per-conversation chain map is stable across two
 * consecutive drains. Without the loop, work queued AFTER the first
 * snapshot is silently dropped at shutdown: at quit we call
 * `clearAllPending()` on the confirm bus FIRST so denied confirms
 * unblock waiting tools — each of those tools returns a `tool-result`
 * that hits `appendEvent`, which extends the existing chain promise
 * (`prev.then(...)`). The original snapshot already-resolved by then
 * doesn't observe the extension, so a flat `Promise.all(values())`
 * resolves before the new tail event has hit disk. Review finding M6.
 *
 * The loop caps at a generous iteration count so a pathological case
 * (tools that themselves emit more tool calls indefinitely) can't
 * hang the shutdown path. Per real runs the chain stabilises in 1–2
 * iterations.
 */
const FLUSH_DRAIN_MAX_PASSES = 8;
export async function flushAll(): Promise<void> {
  try {
    for (let pass = 0; pass < FLUSH_DRAIN_MAX_PASSES; pass++) {
      const before = Array.from(appendChains.values());
      if (before.length === 0) break;
      await Promise.all(before);
      // Re-snapshot. If no chain was extended (or replaced) during
      // the drain, every entry's promise reference equals the one
      // we just awaited and we can stop.
      const after = Array.from(appendChains.values());
      if (
        after.length === before.length &&
        after.every((p, i) => p === before[i])
      ) {
        break;
      }
    }
    // Index flush goes LAST so it observes every `bumpMeta` /
    // `scheduleIndexFlush` triggered by the drained appends.
    await flushIndex();
  } catch {
    /* noop */
  }
}
