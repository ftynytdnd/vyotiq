/**
 * Rewind a conversation to before a user-prompt: revert file changes,
 * drop pending rows, delete run manifests, trim transcript.
 */

import type {
  CheckpointEntry,
  CheckpointRunManifest,
  RewindFileChange,
  RewindPreviewResult,
  RewindResult
} from '@shared/types/checkpoint.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import {
  readTranscript,
  truncateTranscriptFrom,
  drainAppendChain
} from '../conversations/conversationStore.js';
import { abortRunsForConversation } from '../orchestrator/AgentV.js';
import {
  deleteRun,
  dropPendingForRunsExport,
  getRunManifest,
  revertRun
} from './index.js';
import { listRunHeads } from './runManifest.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/rewindToPrompt');

const HEURISTIC_WINDOW_MS = 5_000;

async function resolveRunIdForPrompt(
  promptEvent: Extract<TimelineEvent, { kind: 'user-prompt' }>,
  workspaceId: string,
  conversationId: string
): Promise<string | null> {
  if (typeof promptEvent.runId === 'string' && promptEvent.runId.length > 0) {
    return promptEvent.runId;
  }
  const heads = await listRunHeads(workspaceId);
  let best: { runId: string; delta: number } | null = null;
  for (const head of heads) {
    if (head.conversationId !== conversationId) continue;
    const delta = head.startedAt - promptEvent.ts;
    if (delta < -HEURISTIC_WINDOW_MS || delta > HEURISTIC_WINDOW_MS) continue;
    const absDelta = Math.abs(delta);
    if (!best || absDelta < best.delta) {
      best = { runId: head.runId, delta: absDelta };
    }
  }
  return best ? best.runId : null;
}

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
    transcriptEventsAffected: events.length - idx
  };
}

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
    alreadyReverted: entry.reverted === true,
    blobMissing: entry.kind !== 'create' && !entry.preHash
  };
}

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
  manifests.sort((a, b) => b.startedAt - a.startedAt);
  return manifests;
}

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
  const files: RewindFileChange[] = [];
  const runIds: string[] = [];
  if (runId) {
    const boundaryManifest = await getRunManifest(workspaceId, runId);
    if (boundaryManifest) {
      const affected = await selectAffectedRuns({
        workspaceId,
        conversationId,
        boundaryRunId: runId,
        boundaryStartedAt: boundaryManifest.startedAt
      });
      const seenEntries = new Set<string>();
      for (const manifest of affected) {
        runIds.push(manifest.runId);
        for (let i = manifest.entries.length - 1; i >= 0; i -= 1) {
          const entry = manifest.entries[i]!;
          if (seenEntries.has(entry.id)) continue;
          seenEntries.add(entry.id);
          files.push(entryToFileChange(entry));
        }
      }
    } else {
      runIds.push(runId);
    }
  }

  return {
    ok: true,
    conversationId,
    workspaceId,
    promptEventId,
    promptContent: located.prompt.content,
    promptTs: located.prompt.ts,
    runIds,
    files,
    transcriptEventsAffected: located.transcriptEventsAffected
  };
}

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

  const aborted = abortRunsForConversation(conversationId);
  if (aborted > 0) {
    log.info('rewindToPrompt: aborted in-flight runs', { conversationId, aborted });
    await drainAppendChain(conversationId);
  }

  const preview = await previewRewind({ conversationId, workspaceId, promptEventId });
  if (!preview.ok) {
    return preview;
  }

  const revertedRunIds: string[] = [];
  const revertedFiles: RewindFileChange[] = [];
  const failedFiles: Array<RewindFileChange & { reason: string }> = [];
  let droppedPending = 0;
  let deletedRunManifests = 0;

  for (const runId of preview.runIds) {
    const result = await revertRun(workspaceId, runId);
    if (result.ok && result.reverted > 0) {
      revertedRunIds.push(runId);
      const manifest = await getRunManifest(workspaceId, runId);
      if (manifest) {
        for (const entry of manifest.entries) {
          if (!entry.reverted) continue;
          revertedFiles.push(entryToFileChange(entry));
        }
      }
    } else if (!result.ok) {
      const reason =
        result.error.kind === 'fs' || result.error.kind === 'sandbox'
          ? result.error.message
          : result.error.kind;
      for (const file of preview.files.filter((f) => f.runId === runId)) {
        failedFiles.push({ ...file, reason });
      }
    }
    droppedPending += await dropPendingForRunsExport(workspaceId, new Set([runId]));
    await deleteRun(workspaceId, runId);
    deletedRunManifests++;
  }

  let removedTranscriptEvents = 0;
  try {
    const trimmed = await truncateTranscriptFrom(conversationId, promptEventId);
    removedTranscriptEvents = trimmed.removedCount;
  } catch (err) {
    log.error('rewindToPrompt: truncate failed', { conversationId, promptEventId, err });
  }

  try {
    broadcasters.checkpointsChanged(workspaceId);
  } catch (err) {
    log.debug('checkpointsChanged broadcast threw', { err });
  }
  try {
    broadcasters.transcriptRewound(conversationId);
  } catch (err) {
    log.debug('transcriptRewound broadcast threw', { err });
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
