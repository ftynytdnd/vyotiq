/**
 * Legacy PR-style review session persistence (read-only, Phase 1).
 *
 * One `reviews.json` per workspace: `{ [conversationId]: ReviewSession }`.
 * Write IPC was removed in Phase 1 remediation — this module only READS
 * existing `reviews.json` files for the chat send gate
 * (`reviewSessionBlocksSend`). Orphaned rows are left on disk until manual
 * prune/clear; `gc.pruneOlderThan` no longer walks review metadata.
 */

import { promises as fs, existsSync } from 'node:fs';
import type { ReviewSession } from '@shared/types/checkpoint.js';
import { reviewsFile } from './paths.js';
import { logger } from '../logging/logger.js';

const log = logger.child('checkpoints/reviews');

type ReviewsBucket = Record<string, ReviewSession>;

const cache = new Map<string, ReviewsBucket>();

async function loadBucket(workspaceId: string): Promise<ReviewsBucket> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;
  const path = reviewsFile(workspaceId);
  let bucket: ReviewsBucket = {};
  if (existsSync(path)) {
    try {
      const raw = await fs.readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as ReviewsBucket;
      if (parsed && typeof parsed === 'object') bucket = parsed;
    } catch (err) {
      log.warn('reviews.json unreadable; treating as empty', { workspaceId, err });
    }
  }
  cache.set(workspaceId, bucket);
  return bucket;
}

export async function getReviewSession(
  workspaceId: string,
  conversationId: string
): Promise<ReviewSession | null> {
  const bucket = await loadBucket(workspaceId);
  return bucket[conversationId] ?? null;
}

/**
 * Returns true when a stored review session has `decision === 'request_changes'`.
 * Callers gate on `gatePromptOnReviewRequestChangesByWorkspace` first.
 * Internal to main (`chat.ipc`) — not exposed over IPC.
 */
export async function reviewSessionBlocksSend(
  workspaceId: string,
  conversationId: string
): Promise<boolean> {
  const session = await getReviewSession(workspaceId, conversationId);
  return session?.decision === 'request_changes';
}
