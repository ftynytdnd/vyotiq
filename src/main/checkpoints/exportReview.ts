/**
 * Export a conversation's PR-style review session to a JSON file in
 * the workspace root (same pattern as checkpoint archive export).
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ReviewExportBundle, ReviewExportResult } from '@shared/types/checkpoint.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { listForConversation } from './pendingChanges.js';
import { getReviewSession } from './reviewSessions.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/exportReview');

export async function exportReviewSession(input: {
  workspaceId: string;
  conversationId: string;
}): Promise<ReviewExportResult> {
  const workspacePath = await requireWorkspaceById(input.workspaceId);
  const session = await getReviewSession(input.workspaceId, input.conversationId);
  if (!session) {
    throw new Error('No review session exists for this conversation.');
  }

  const pendingChanges = await listForConversation(input.conversationId, [input.workspaceId]);

  const bundle: ReviewExportBundle = {
    version: 1,
    exportedAt: Date.now(),
    session,
    pendingChanges
  };

  const stamp = new Date(bundle.exportedAt).toISOString().replace(/[:.]/g, '-');
  const shortId = input.conversationId.slice(0, 8);
  const exportPath = join(workspacePath, `vyotiq-review-${shortId}-${stamp}.json`);
  const payload = JSON.stringify(bundle, null, 2);
  await fs.writeFile(exportPath, payload, 'utf8');
  log.info('review export written', {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    exportPath,
    bytes: payload.length
  });
  return { exportPath, bytes: payload.length };
}
