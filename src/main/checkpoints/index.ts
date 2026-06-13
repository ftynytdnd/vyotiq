/**
 * Public API for the checkpoint store.
 */

import { randomUUID } from 'node:crypto';
import type {
  CheckpointEntry,
  CheckpointChangeKind,
  CheckpointRevertResult,
  PendingChange
} from '@shared/types/checkpoint.js';
import type { DiffHunk as ToolDiffHunk } from '@shared/types/tool.js';
import { writeBlob, readBlob } from './blobStore.js';
import {
  openRun as openRunInternal,
  finalizeRun as finalizeRunInternal,
  appendEntry,
  flushAll as flushRunManifests,
  readRun,
  deleteRun as deleteRunManifest
} from './runManifest.js';
import {
  listForConversation,
  addPending,
  dropByEntryId,
  dropOne,
  dropAllForConversation,
  dropPendingForRuns,
  flushAll as flushPending
} from './pendingChanges.js';
import { revertEntryDirect, revertRun as revertRunInternal } from './revert.js';

const entryIndex = new Map<
  string,
  { workspaceId: string; runId: string; conversationId: string }
>();

let broadcaster: ((workspaceId: string) => void) | null = null;

export function setCheckpointsBroadcaster(fn: ((workspaceId: string) => void) | null): void {
  broadcaster = fn;
}

function broadcast(workspaceId: string): void {
  try {
    broadcaster?.(workspaceId);
  } catch {
    /* swallow */
  }
}

function rememberEntry(entry: CheckpointEntry): void {
  entryIndex.set(entry.id, {
    workspaceId: entry.workspaceId,
    runId: entry.runId,
    conversationId: entry.conversationId
  });
}

export function lookupEntryLocation(entryId: string): {
  workspaceId: string;
  runId: string;
  conversationId: string;
} | null {
  return entryIndex.get(entryId) ?? null;
}

export async function openRun(opts: {
  runId: string;
  conversationId: string;
  workspaceId: string;
  label: string;
  startedAt: number;
}): Promise<void> {
  await openRunInternal(opts);
}

export async function finalizeRun(runId: string): Promise<void> {
  await finalizeRunInternal(runId);
}

interface RecordChangeOpts {
  runId: string;
  conversationId: string;
  workspaceId: string;
  filePath: string;
  kind: CheckpointChangeKind;
  preContent?: string;
  postContent?: string;
  additions: number;
  deletions: number;
  hunks?: ToolDiffHunk[];
  source: 'edit' | 'delete' | 'bash';
}

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
    source: opts.source
  };

  rememberEntry(entry);
  await appendEntry(entry);

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
    source: opts.source
  };
  await addPending(pending);
  broadcast(opts.workspaceId);
  return entry;
}

export async function acceptEntry(entryId: string): Promise<boolean> {
  const loc = lookupEntryLocation(entryId);
  if (loc) {
    return acceptEntryStrict(loc.workspaceId, loc.conversationId, entryId);
  }
  const removed = await dropByEntryId(entryId);
  if (!removed) return false;
  broadcast(removed.workspaceId);
  return true;
}

export async function acceptEntryStrict(
  workspaceId: string,
  conversationId: string,
  entryId: string
): Promise<boolean> {
  const dropped = await dropOne(workspaceId, conversationId, entryId);
  if (!dropped) return false;
  broadcast(workspaceId);
  return true;
}

export async function acceptAll(
  conversationId: string,
  knownWorkspaceIds?: readonly string[]
): Promise<number> {
  const count = await dropAllForConversation(conversationId, knownWorkspaceIds);
  if (count > 0) broadcast('*');
  return count;
}

export async function rejectEntry(entryId: string): Promise<CheckpointRevertResult> {
  const loc = lookupEntryLocation(entryId);
  let workspaceId: string | undefined;
  let runId: string | undefined;
  if (loc) {
    workspaceId = loc.workspaceId;
    runId = loc.runId;
    await dropOne(loc.workspaceId, loc.conversationId, entryId);
  } else {
    const removed = await dropByEntryId(entryId);
    if (!removed) {
      return { ok: false, error: { kind: 'unknown-entry', entryId } };
    }
    workspaceId = removed.workspaceId;
    runId = removed.change.runId;
  }
  if (workspaceId && runId) {
    return revertEntryById(workspaceId, runId, entryId);
  }
  return { ok: false, error: { kind: 'unknown-entry', entryId } };
}

export async function revertEntryById(
  workspaceId: string,
  runId: string,
  entryId: string
): Promise<CheckpointRevertResult> {
  const manifest = await readRun(workspaceId, runId);
  const entry = manifest?.entries.find((e) => e.id === entryId);
  if (!entry) {
    return { ok: false, error: { kind: 'unknown-entry', entryId } };
  }
  const result = await revertEntryDirect(entry);
  if (result.ok) broadcast(workspaceId);
  return result;
}

export async function revertRun(
  workspaceId: string,
  runId: string
): Promise<CheckpointRevertResult> {
  const result = await revertRunInternal(workspaceId, runId);
  if (result.ok) broadcast(workspaceId);
  return result;
}

export async function getRunManifest(
  workspaceId: string,
  runId: string
): ReturnType<typeof readRun> {
  const manifest = await readRun(workspaceId, runId);
  if (manifest) {
    for (const e of manifest.entries) {
      rememberEntry(e);
    }
  }
  return manifest;
}

export const listPending = listForConversation;
export const dropPendingForRunsExport = dropPendingForRuns;
export const deleteRun = deleteRunManifest;
export const readBlobBody = readBlob;

export async function flushAll(): Promise<void> {
  await Promise.all([flushRunManifests(), flushPending()]);
}
