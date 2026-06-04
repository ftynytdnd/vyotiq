/**
 * Public API for the checkpoint store. Tools, the orchestrator, rewind
 * IPC, and shutdown hooks import from this file — not from submodules.
 *
 * Per-edit blob/pending persistence is disabled: `recordChange` returns a
 * stub entry so tools can still attach `entryId` on file-edit cards. Run
 * manifests (`openRun` / `finalizeRun`) remain for rewind preview metadata.
 */

import { randomUUID } from 'node:crypto';
import type {
  CheckpointEntry,
  CheckpointChangeKind
} from '@shared/types/checkpoint.js';
import type { DiffHunk as ToolDiffHunk } from '@shared/types/tool.js';
import {
  openRun as openRunInternal,
  finalizeRun as finalizeRunInternal,
  flushAll as flushRunManifests,
  readRun
} from './runManifest.js';
import {
  listForConversation,
  flushAll as flushPending
} from './pendingChanges.js';

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
  source: 'edit' | 'delete' | 'bash';
}

/** Stub entry for tool cards — does not persist blobs or pending rows. */
export async function recordChange(opts: RecordChangeOpts): Promise<CheckpointEntry> {
  const entryId = randomUUID();
  const ts = Date.now();
  return {
    id: entryId,
    runId: opts.runId,
    conversationId: opts.conversationId,
    workspaceId: opts.workspaceId,
    ts,
    filePath: opts.filePath,
    kind: opts.kind,
    additions: opts.additions,
    deletions: opts.deletions,
    ...(opts.hunks ? { hunks: opts.hunks } : {}),
    ...(opts.subagentId ? { subagentId: opts.subagentId } : {}),
    source: opts.source
  };
}

/** Read a run manifest off disk (or from the open-run cache). */
export async function getRunManifest(
  workspaceId: string,
  runId: string
): ReturnType<typeof readRun> {
  return readRun(workspaceId, runId);
}

export const listPending = listForConversation;

/** Drain every in-flight checkpoint write. Called from app `before-quit`. */
export async function flushAll(): Promise<void> {
  await Promise.all([flushRunManifests(), flushPending()]);
}
