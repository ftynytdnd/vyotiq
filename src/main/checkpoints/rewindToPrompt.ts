/**
 * Rewind a conversation to the moment just before a specific
 * `user-prompt` event was sent.
 *
 * Two operations live here:
 *
 *   1. `previewRewind(conversationId, workspaceId, promptEventId)` —
 *      compute impact for the confirmation modal: checkpoint-recorded
 *      file edits (informational — on-disk files are **not** reverted),
 *      affected run ids, and how many transcript events would be removed.
 *      Does not mutate disk.
 *
 *   2. `rewindToPrompt(...)` — perform a **transcript-only** rewind:
 *        a. Abort every in-flight run pinned to this conversation
 *           (mirrors `removeConversation` / `moveConversationToWorkspace`
 *           — re-using the orchestrator's abort hook so we never trim
 *           JSONL while a live run is still streaming).
 *        b. Drain the append chain so late tail events cannot resurrect
 *           after truncate.
 *        c. Truncate the JSONL transcript from the prompt event onward.
 *        d. Broadcast `checkpointsChanged` (pending cache refresh) and
 *           `CONVERSATION_TRANSCRIPT_REWOUND` so renderer stores reload.
 *
 *      Checkpoint file restore (`revertRun`, pending drops, manifest
 *      deletion) is intentionally disabled — workspace files stay as-is.
 *      `RewindResult.revertedFiles` / `revertedRunIds` remain empty arrays
 *      for API compatibility.
 *
 * The `runId` link comes from the `user-prompt` event's optional
 * `runId` field (see `src/shared/types/chat.ts`). Older transcripts
 * fall back to a `(conversationId, startedAt ≈ promptEvent.ts)`
 * heuristic against the workspace's run heads.
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
import { getRunManifest } from './index.js';
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

  // Checkpoint file restore is disabled — rewind trims the transcript
  // only. On-disk files are left unchanged.
  const revertedRunIds: string[] = [];
  const revertedFiles: RewindFileChange[] = [];
  const failedFiles: Array<RewindFileChange & { reason: string }> = [];
  const droppedPending = 0;
  const deletedRunManifests = 0;

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
