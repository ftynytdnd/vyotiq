/**
 * Rewind a conversation to the moment just before a specific
 * `user-prompt` event was sent.
 *
 * Two operations live here:
 *
 *   1. `previewRewind(conversationId, workspaceId, promptEventId)` —
 *      compute the impact (run ids, file changes, transcript trim
 *      count) WITHOUT touching disk. Drives the renderer's
 *      confirmation modal.
 *
 *   2. `rewindToPrompt(...)` — actually perform the rewind:
 *        a. Abort every in-flight run pinned to this conversation
 *           (mirrors `removeConversation` / `moveConversationToWorkspace`
 *           — re-using the orchestrator's abort hook so we never
 *           rewrite a transcript a live run is still streaming into).
 *        b. Walk the affected runs newest-first and call `revertRun`
 *           on each. Each `revertRun` already restores entries in
 *           reverse chronological order inside the run, so overlapping
 *           edits across runs collapse cleanly back to the pre-rewind
 *           state.
 *        c. Drop every pending entry whose `runId` is in the affected
 *           set.
 *        d. Delete the now-empty run manifests (their audit trail is
 *           gone with the transcript anyway — keeping them would just
 *           accumulate dead history pointing at events that no longer
 *           exist).
 *        e. Truncate the JSONL transcript from the prompt event
 *           inclusive.
 *        f. Broadcast `CHECKPOINTS_CHANGED` AND
 *           `CONVERSATION_TRANSCRIPT_REWOUND` so every renderer cache
 *           refreshes in one shot.
 *
 * The `runId` link comes from the `user-prompt` event's new optional
 * `runId` field (added when the schema was migrated — see
 * `src/shared/types/chat.ts`). Older transcripts that lack the field
 * fall back to a `(conversationId, startedAt ≈ promptEvent.ts)`
 * heuristic match against the workspace's run heads.
 */

import type {
  CheckpointEntry,
  CheckpointRunManifest,
  RewindFileChange,
  RewindPreviewResult,
  RewindResult
} from '@shared/types/checkpoint.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import { readTranscript, truncateTranscriptFrom, drainAppendChain } from '../conversations/conversationStore.js';
import { abortRunsForConversation } from '../orchestrator/AgentV.js';
import {
  deleteRun as deleteRunPublic,
  dropPendingForRuns,
  getRunManifest,
  revertRun
} from './index.js';
import { listRunHeads } from './runManifest.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/rewindToPrompt');

/** Window (ms) inside which a manifest's `startedAt` is allowed to lag behind a prompt's `ts` for the heuristic match. */
const HEURISTIC_WINDOW_MS = 5_000;

/**
 * Resolve which run a `user-prompt` event opened. Prefers the
 * authoritative `event.runId` (added in the schema migration) and
 * falls back to a `startedAt`-window heuristic for transcripts
 * persisted before the field was introduced.
 *
 * Returns `null` when no manifest matches (very old transcripts where
 * the run produced no FS edits, hence no manifest was opened — those
 * runs are safely "nothing to revert" and the caller renders the
 * Revert affordance disabled).
 */
async function resolveRunIdForPrompt(
  promptEvent: Extract<TimelineEvent, { kind: 'user-prompt' }>,
  workspaceId: string,
  conversationId: string
): Promise<string | null> {
  if (typeof promptEvent.runId === 'string' && promptEvent.runId.length > 0) {
    return promptEvent.runId;
  }
  // Heuristic fallback. Walk the workspace's run heads and pick the
  // one whose `startedAt` is closest to (and >=) the prompt's ts,
  // bounded by `HEURISTIC_WINDOW_MS`.
  const heads = await listRunHeads(workspaceId);
  let best: { runId: string; delta: number } | null = null;
  for (const head of heads) {
    if (head.conversationId !== conversationId) continue;
    const delta = head.startedAt - promptEvent.ts;
    if (delta < -HEURISTIC_WINDOW_MS) continue;
    if (delta > HEURISTIC_WINDOW_MS) continue;
    const absDelta = Math.abs(delta);
    if (!best || absDelta < best.delta) {
      best = { runId: head.runId, delta: absDelta };
    }
  }
  return best ? best.runId : null;
}

/**
 * Find the prompt event in a transcript (by `id`) and return it
 * alongside the count of trailing events the rewind would remove.
 */
function locatePrompt(
  events: TimelineEvent[],
  promptEventId: string
):
  | {
    prompt: Extract<TimelineEvent, { kind: 'user-prompt' }>;
    transcriptEventsAffected: number;
  }
  | null {
  const idx = events.findIndex((e) => e.id === promptEventId);
  if (idx < 0) return null;
  const candidate = events[idx]!;
  if (candidate.kind !== 'user-prompt') return null;
  return {
    prompt: candidate,
    // The boundary event itself is also removed, so the trim count
    // includes it.
    transcriptEventsAffected: events.length - idx
  };
}

/**
 * Build a preview row from a manifest entry. Stable shape — both
 * preview and rewind paths use this so the user sees the exact same
 * file list before and after.
 */
function entryToFileChange(entry: CheckpointEntry): RewindFileChange {
  return {
    filePath: entry.filePath,
    kind: entry.kind,
    workspaceId: entry.workspaceId,
    runId: entry.runId,
    entryId: entry.id,
    ...(entry.preHash ? { preHash: entry.preHash } : {}),
    ...(entry.postHash ? { postHash: entry.postHash } : {}),
    additions: entry.additions,
    deletions: entry.deletions,
    alreadyReverted: entry.reverted === true
  };
}

/**
 * Internal: compute the set of runs whose start time lands at or
 * after `boundaryStartedAt` AND whose `conversationId` matches.
 * Newest-first by `startedAt` so the caller can revert in the right
 * order. The boundary's own run is always included (the user clicks
 * Revert ON its prompt — the run that prompt opened must be rolled
 * back too).
 */
async function selectAffectedRuns(opts: {
  workspaceId: string;
  conversationId: string;
  boundaryRunId: string;
  boundaryStartedAt: number;
}): Promise<CheckpointRunManifest[]> {
  const heads = await listRunHeads(opts.workspaceId);
  const candidateIds = new Set<string>([opts.boundaryRunId]);
  for (const head of heads) {
    if (head.conversationId !== opts.conversationId) continue;
    if (head.startedAt >= opts.boundaryStartedAt) {
      candidateIds.add(head.runId);
    }
  }
  const manifests: CheckpointRunManifest[] = [];
  for (const runId of candidateIds) {
    const manifest = await getRunManifest(opts.workspaceId, runId);
    if (manifest) manifests.push(manifest);
  }
  // Newest-first.
  manifests.sort((a, b) => b.startedAt - a.startedAt);
  return manifests;
}

/**
 * Compute everything the rewind would do, without touching disk. The
 * renderer paints this in its confirmation modal so the user can
 * inspect the impact before confirming.
 */
export async function previewRewind(opts: {
  conversationId: string;
  workspaceId: string;
  promptEventId: string;
}): Promise<RewindPreviewResult> {
  const { conversationId, workspaceId, promptEventId } = opts;
  let events: TimelineEvent[];
  try {
    events = await readTranscript(conversationId);
  } catch (err) {
    return {
      ok: false,
      error: { kind: 'fs', message: err instanceof Error ? err.message : String(err) }
    };
  }
  if (events.length === 0) {
    return { ok: false, error: { kind: 'unknown-conversation', conversationId } };
  }
  const located = locatePrompt(events, promptEventId);
  if (!located) {
    return { ok: false, error: { kind: 'unknown-prompt', promptEventId } };
  }
  const runId = await resolveRunIdForPrompt(located.prompt, workspaceId, conversationId);
  if (!runId) {
    // No manifest could be resolved. The renderer surfaces this as a
    // "nothing to revert here" state rather than offering a destructive
    // action with no concrete file rollback. Still legitimate: prompts
    // that produced no FS edits.
    return {
      ok: false,
      error: { kind: 'no-run-binding', promptEventId }
    };
  }
  const boundaryManifest = await getRunManifest(workspaceId, runId);
  if (!boundaryManifest) {
    return { ok: false, error: { kind: 'no-run-binding', promptEventId } };
  }
  const affected = await selectAffectedRuns({
    workspaceId,
    conversationId,
    boundaryRunId: runId,
    boundaryStartedAt: boundaryManifest.startedAt
  });

  const files: RewindFileChange[] = [];
  const seenEntries = new Set<string>();
  // `affected` is newest-first; within each manifest, the entries are
  // append-only (oldest-first). The user will see them in
  // newest-first order — same direction the actual revert walks —
  // so iterate manifest forward but flip the per-manifest entries.
  for (const manifest of affected) {
    for (let i = manifest.entries.length - 1; i >= 0; i -= 1) {
      const entry = manifest.entries[i]!;
      if (seenEntries.has(entry.id)) continue;
      seenEntries.add(entry.id);
      files.push(entryToFileChange(entry));
    }
  }
  return {
    ok: true,
    conversationId,
    workspaceId,
    promptEventId,
    promptContent: located.prompt.content,
    promptTs: located.prompt.ts,
    runIds: affected.map((m) => m.runId),
    files,
    transcriptEventsAffected: located.transcriptEventsAffected
  };
}

/**
 * Atomically execute the rewind. Builds a fresh preview internally
 * (so the renderer's preview can be slightly stale and we still
 * revert against the live disk state) and then walks the steps
 * described at the top of this file.
 *
 * `broadcasters` is passed in by the IPC handler so we don't import
 * `electron`'s `BrowserWindow` here. Both broadcasts MUST fire even
 * on partial failure — the renderer needs to refresh whatever did
 * land.
 */
export async function rewindToPrompt(opts: {
  conversationId: string;
  workspaceId: string;
  promptEventId: string;
  broadcasters: {
    checkpointsChanged: (workspaceId: string) => void;
    transcriptRewound: (conversationId: string) => void;
  };
}): Promise<RewindResult> {
  const { conversationId, workspaceId, promptEventId, broadcasters } = opts;

  // Abort any in-flight run pinned to this conversation BEFORE we
  // start mutating manifests / transcript. Identical contract to
  // `removeConversation` / `moveConversationToWorkspace`.
  const aborted = abortRunsForConversation(conversationId);
  if (aborted > 0) {
    log.info('rewindToPrompt: aborted in-flight runs', {
      conversationId,
      aborted
    });
    // Mirror `chat.ipc.ts` supersede: `abortRun` only flips the signal;
    // tail `appendEvent` calls from the winding-down run may still be
    // flushing. Drain before we revert files or trim JSONL so a late
    // tail cannot resurrect events truncate just removed.
    await drainAppendChain(conversationId);
  }

  // Recompute the preview against live disk state so a slightly
  // stale renderer-side preview never causes us to revert the wrong
  // run set.
  const preview = await previewRewind({ conversationId, workspaceId, promptEventId });
  if (!preview.ok) {
    return preview;
  }

  const revertedRunIds: string[] = [];
  const revertedFiles: RewindFileChange[] = [];
  const failedFiles: Array<RewindFileChange & { reason: string }> = [];

  // Walk affected runs newest-first.
  // `revertRun` already iterates each manifest's entries reverse so
  // the cumulative effect is "every file restored to its pre-rewind
  // state".
  // Capture entry shapes BEFORE the revert so we can attribute
  // failures back to specific files.
  const entryShapeByRun = new Map<string, RewindFileChange[]>();
  for (const runId of preview.runIds) {
    const manifest = await getRunManifest(workspaceId, runId);
    if (!manifest) continue;
    entryShapeByRun.set(
      runId,
      // newest-first inside the run
      manifest.entries.slice().reverse().map(entryToFileChange)
    );
  }

  for (const runId of preview.runIds) {
    const beforeShape = entryShapeByRun.get(runId) ?? [];
    const result = await revertRun(workspaceId, runId, () => {
      // Audit-log emit: rewind events live in the conversation's
      // transcript via the trim, NOT as inline `checkpoint-revert`
      // rows. We pass a no-op so `revertRun` doesn't append per-file
      // audit rows that are about to disappear with the transcript
      // trim a few steps below.
    });
    if (!result.ok) {
      const reason =
        result.error.kind === 'blob-missing'
          ? `Snapshot missing for ${result.error.hash.slice(0, 8)}…`
          : result.error.kind === 'fs'
            ? result.error.message
            : result.error.kind === 'sandbox'
              ? result.error.message
              : `unknown-run ${runId}`;
      // Mark every file from this run as failed since we don't know
      // which entry in the chain blew up. The renderer surfaces this
      // as "N files could not be reverted" with the per-row reason.
      for (const f of beforeShape) {
        failedFiles.push({ ...f, reason });
      }
      log.warn('rewindToPrompt: revertRun failed', {
        conversationId,
        workspaceId,
        runId,
        error: result.error
      });
      // Continue with remaining runs — each run is independent on
      // disk; failing one shouldn't strand the rest of the rewind.
      continue;
    }
    revertedRunIds.push(runId);
    for (const f of beforeShape) {
      revertedFiles.push(f);
    }
  }

  // Drop pending rows for every reverted run. Pass the affected
  // workspace so the bucket is warm even on cold-cache renderer
  // boots.
  let droppedPending = 0;
  if (revertedRunIds.length > 0) {
    droppedPending = await dropPendingForRuns(revertedRunIds, [workspaceId]);
  }

  // Delete the run manifests we just reverted. The audit trail is
  // gone alongside the transcript trim below — keeping these would
  // pile up dead heads in `Checkpoints.summary.runs`. Idempotent.
  let deletedRunManifests = 0;
  for (const runId of revertedRunIds) {
    const r = await deleteRunPublic(workspaceId, runId);
    if (r.removed) deletedRunManifests += 1;
  }

  // Truncate the transcript JSONL from the prompt event onward.
  let removedTranscriptEvents = 0;
  try {
    const trimmed = await truncateTranscriptFrom(conversationId, promptEventId);
    removedTranscriptEvents = trimmed.removedCount;
  } catch (err) {
    log.error('rewindToPrompt: truncate failed', {
      conversationId,
      promptEventId,
      err
    });
  }

  // Broadcasts. Always fire — even on partial failure, every
  // renderer cache that COULD have been affected must refresh so the
  // UI doesn't show stale rows.
  try {
    broadcasters.checkpointsChanged(workspaceId);
  } catch (err) {
    log.debug('rewindToPrompt: checkpointsChanged broadcast threw', { err });
  }
  try {
    broadcasters.transcriptRewound(conversationId);
  } catch (err) {
    log.debug('rewindToPrompt: transcriptRewound broadcast threw', { err });
  }

  return {
    ok: true,
    conversationId,
    workspaceId,
    promptEventId,
    revertedRunIds,
    revertedFiles,
    failedFiles,
    removedTranscriptEvents,
    deletedRunManifests,
    droppedPending
  };
}
