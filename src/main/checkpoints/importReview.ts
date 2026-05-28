/**
 * Import a review export bundle from a workspace-local JSON file.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { isAbsolute } from 'node:path';
import { dialog } from 'electron';
import type {
  PendingChange,
  ReviewExportBundle,
  ReviewImportResult,
  ReviewSession
} from '@shared/types/checkpoint.js';
import type { ReviewImportMode } from '@shared/checkpoints/reviewImportMerge.js';
import {
  mergeReviewSessions,
  normalizeImportedSession,
  reviewSessionHasContent
} from '@shared/checkpoints/reviewImportMerge.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { resolveInsideWorkspace } from '../tools/sandbox.js';
import { IpcCancelledError } from '../ipc/ipcCancelledError.js';
import { addPending, listForConversation } from './pendingChanges.js';
import { getReviewSession, upsertReviewSession } from './reviewSessions.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/importReview');

const MAX_BYTES = 2 * 1024 * 1024;

function isReviewBundle(value: unknown): value is ReviewExportBundle {
  if (!value || typeof value !== 'object') return false;
  const b = value as ReviewExportBundle;
  return b.version === 1 && b.session !== undefined && typeof b.session === 'object';
}

async function resolveImportMode(input: {
  existing: ReviewSession;
  incoming: ReviewSession;
  sourceConversationId: string;
  targetConversationId: string;
  mode?: ReviewImportMode;
}): Promise<ReviewImportMode> {
  if (input.mode) return input.mode;
  if (!reviewSessionHasContent(input.existing)) return 'replace';

  const crossConv = input.sourceConversationId !== input.targetConversationId;
  const existingComments = input.existing.comments.length;
  const incomingComments = input.incoming.comments.length;

  const detail = [
    crossConv
      ? `Importing review exported from another conversation (${input.sourceConversationId.slice(0, 8)}…).`
      : 'This conversation already has review metadata.',
    existingComments > 0 ? `${existingComments} local comment${existingComments === 1 ? '' : 's'}.` : null,
    incomingComments > 0
      ? `${incomingComments} comment${incomingComments === 1 ? '' : 's'} in the file.`
      : null,
    'Merge keeps local comments and overlays imported decisions; Replace discards the current review.'
  ]
    .filter(Boolean)
    .join(' ');

  const { response } = await dialog.showMessageBox({
    type: 'question',
    title: 'Import review',
    message: 'Replace or merge with the existing review?',
    detail,
    buttons: ['Merge', 'Replace', 'Cancel'],
    defaultId: 0,
    cancelId: 2
  });

  if (response === 2) {
    throw new IpcCancelledError('review_import_cancelled');
  }
  return response === 0 ? 'merge' : 'replace';
}

function isPendingChangeRow(value: unknown): value is PendingChange {
  if (!value || typeof value !== 'object') return false;
  const row = value as PendingChange;
  return (
    typeof row.entryId === 'string' &&
    row.entryId.length > 0 &&
    typeof row.runId === 'string' &&
    typeof row.filePath === 'string' &&
    row.filePath.length > 0 &&
    (row.kind === 'create' || row.kind === 'modify' || row.kind === 'delete') &&
    typeof row.additions === 'number' &&
    typeof row.deletions === 'number' &&
    typeof row.createdAt === 'number'
  );
}

/** Merge exported pending rows; skip duplicate `entryId` in the target conversation. */
async function restorePendingFromBundle(input: {
  workspaceId: string;
  conversationId: string;
  pendingChanges: readonly unknown[];
}): Promise<{ restored: number; skipped: number }> {
  const existing = await listForConversation(input.conversationId, [input.workspaceId]);
  const seen = new Set(existing.map((p) => p.entryId));
  let restored = 0;
  let skipped = 0;

  for (const raw of input.pendingChanges) {
    if (!isPendingChangeRow(raw)) {
      skipped++;
      continue;
    }
    if (seen.has(raw.entryId)) {
      skipped++;
      continue;
    }
    const normalized: PendingChange = {
      ...raw,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId
    };
    await addPending(normalized);
    seen.add(normalized.entryId);
    restored++;
  }

  return { restored, skipped };
}

export async function importReviewSession(input: {
  workspaceId: string;
  conversationId: string;
  filePath?: string;
  mode?: ReviewImportMode;
  restorePending?: boolean;
}): Promise<ReviewImportResult> {
  const workspacePath = await requireWorkspaceById(input.workspaceId);

  let resolved = input.filePath?.trim();
  if (!resolved) {
    const picked = await dialog.showOpenDialog({
      title: 'Import Vyotiq review JSON',
      defaultPath: workspacePath,
      filters: [{ name: 'Vyotiq review export', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      throw new IpcCancelledError('review_import_cancelled');
    }
    resolved = picked.filePaths[0]!;
  }

  const absPath = resolveInsideWorkspace(
    workspacePath,
    isAbsolute(resolved) ? resolved : resolved.replace(/\\/g, '/')
  );

  const raw = await fs.readFile(absPath, 'utf8');
  if (raw.length > MAX_BYTES) {
    throw new Error('Review file is too large to import.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Review file is not valid JSON.');
  }
  if (!isReviewBundle(parsed)) {
    throw new Error('Unrecognized review bundle format (expected version 1).');
  }

  const target = {
    conversationId: input.conversationId,
    workspaceId: input.workspaceId
  };
  const incoming = normalizeImportedSession(parsed.session, target);

  const existing =
    (await getReviewSession(input.workspaceId, input.conversationId)) ??
    ({
      conversationId: input.conversationId,
      workspaceId: input.workspaceId,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      comments: []
    } satisfies ReviewSession);

  const mode = await resolveImportMode({
    existing,
    incoming,
    sourceConversationId: parsed.session.conversationId,
    targetConversationId: input.conversationId,
    ...(input.mode ? { mode: input.mode } : {})
  });

  const session =
    mode === 'merge'
      ? mergeReviewSessions(existing, incoming, target, () => randomUUID())
      : incoming;

  const stored = await upsertReviewSession(input.workspaceId, session);

  let pendingRestore: ReviewImportResult['pendingRestore'];
  if (input.restorePending && Array.isArray(parsed.pendingChanges)) {
    pendingRestore = await restorePendingFromBundle({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      pendingChanges: parsed.pendingChanges
    });
    log.info('review import restored pending rows', {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      ...pendingRestore
    });
  }

  log.info('review import applied', {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    from: absPath,
    mode
  });
  return {
    session: stored,
    applied: mode,
    ...(pendingRestore ? { pendingRestore } : {})
  };
}
