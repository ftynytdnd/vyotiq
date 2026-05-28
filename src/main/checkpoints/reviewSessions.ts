/**
 * PR-style review session persistence (slice 1).
 *
 * One `reviews.json` per workspace: `{ [conversationId]: ReviewSession }`.
 * Metadata only — does not accept/reject pending rows on disk.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import type {
  FileReviewComment,
  ReviewDecision,
  ReviewSession
} from '@shared/types/checkpoint.js';
import { reviewSessionBlocksSend } from '@shared/checkpoints/reviewSessionBlocksSend.js';

export { reviewSessionBlocksSend };
import { reviewsFile } from './paths.js';
import { atomicWriteJson } from './atomicWrite.js';
import { logger } from '../logging/logger.js';
import { listForConversation } from './pendingChanges.js';
import { listRunHeads } from './runManifest.js';

const log = logger.child('checkpoints/reviews');

type ReviewsBucket = Record<string, ReviewSession>;

const cache = new Map<string, ReviewsBucket>();
const writeChains = new Map<string, Promise<void>>();

function serialize(workspaceId: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeChains.get(workspaceId) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
      await fn();
    } catch (err) {
      log.error('reviews write failed', { workspaceId, err });
      throw err;
    }
  });
  writeChains.set(workspaceId, next);
  return next;
}

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
      log.warn('reviews.json unreadable; starting fresh', { workspaceId, err });
    }
  }
  cache.set(workspaceId, bucket);
  return bucket;
}

async function persist(workspaceId: string, bucket: ReviewsBucket): Promise<void> {
  await atomicWriteJson(reviewsFile(workspaceId), bucket);
}

/** Clone, persist, then swap cache — cache never advances past durable disk. */
async function writeBucket(
  workspaceId: string,
  mutate: (draft: ReviewsBucket) => void
): Promise<ReviewsBucket> {
  const draft = structuredClone(await loadBucket(workspaceId)) as ReviewsBucket;
  mutate(draft);
  await serialize(workspaceId, async () => {
    await persist(workspaceId, draft);
    cache.set(workspaceId, draft);
  });
  return draft;
}

export async function getReviewSession(
  workspaceId: string,
  conversationId: string
): Promise<ReviewSession | null> {
  const bucket = await loadBucket(workspaceId);
  return bucket[conversationId] ?? null;
}

/** Replace the review session for a conversation (import / restore). */
export async function upsertReviewSession(
  workspaceId: string,
  session: ReviewSession
): Promise<ReviewSession> {
  const bucket = await writeBucket(workspaceId, (draft) => {
    draft[session.conversationId] = {
      ...session,
      workspaceId,
      updatedAt: Date.now()
    };
  });
  return bucket[session.conversationId]!;
}

export async function ensureReviewSession(input: {
  workspaceId: string;
  conversationId: string;
  runId?: string;
}): Promise<ReviewSession> {
  const bucket = await loadBucket(input.workspaceId);
  const existing = bucket[input.conversationId];
  if (existing) return existing;
  const now = Date.now();
  const session: ReviewSession = {
    conversationId: input.conversationId,
    workspaceId: input.workspaceId,
    ...(input.runId ? { runId: input.runId } : {}),
    startedAt: now,
    updatedAt: now,
    comments: []
  };
  const next = await writeBucket(input.workspaceId, (draft) => {
    draft[input.conversationId] = session;
  });
  return next[input.conversationId]!;
}

function normalizeLine(line: number | undefined): number | undefined {
  if (line === undefined) return undefined;
  if (!Number.isInteger(line) || line < 1 || line > 999_999) {
    throw new Error('Comment line must be a positive integer.');
  }
  return line;
}

export async function setReviewGitBaseRef(input: {
  workspaceId: string;
  conversationId: string;
  ref: string;
}): Promise<ReviewSession> {
  const trimmed = input.ref.trim();
  if (!trimmed) {
    throw new Error('Git ref is empty.');
  }
  await ensureReviewSession({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId
  });
  const bucket = await writeBucket(input.workspaceId, (draft) => {
    const session = draft[input.conversationId]!;
    session.gitBaseRef = trimmed;
    session.updatedAt = Date.now();
  });
  return bucket[input.conversationId]!;
}

export async function addReviewComment(input: {
  workspaceId: string;
  conversationId: string;
  filePath: string;
  body: string;
  line?: number;
}): Promise<FileReviewComment> {
  const trimmed = input.body.trim();
  if (!trimmed) {
    throw new Error('Comment body is empty.');
  }
  const line = normalizeLine(input.line);
  await ensureReviewSession({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId
  });
  const comment: FileReviewComment = {
    id: randomUUID(),
    filePath: input.filePath,
    body: trimmed,
    ts: Date.now(),
    ...(line !== undefined ? { line } : {})
  };
  await writeBucket(input.workspaceId, (draft) => {
    const session = draft[input.conversationId]!;
    session.comments = [...session.comments, comment];
    session.updatedAt = Date.now();
  });
  return comment;
}

export async function setReviewReviewerLabel(input: {
  workspaceId: string;
  conversationId: string;
  reviewerLabel: string;
}): Promise<ReviewSession> {
  const trimmed = input.reviewerLabel.trim();
  await ensureReviewSession({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId
  });
  const bucket = await writeBucket(input.workspaceId, (draft) => {
    const session = draft[input.conversationId]!;
    if (trimmed) {
      session.reviewerLabel = trimmed;
    } else {
      delete session.reviewerLabel;
    }
    session.updatedAt = Date.now();
  });
  return bucket[input.conversationId]!;
}

export async function setReviewDecision(input: {
  workspaceId: string;
  conversationId: string;
  decision: ReviewDecision;
  filePath?: string;
}): Promise<ReviewSession> {
  await ensureReviewSession({
    workspaceId: input.workspaceId,
    conversationId: input.conversationId
  });
  const bucket = await writeBucket(input.workspaceId, (draft) => {
    const session = draft[input.conversationId]!;
    session.decision = input.decision;
    session.updatedAt = Date.now();
    if (input.filePath) {
      session.fileDecisions = {
        ...(session.fileDecisions ?? {}),
        [input.filePath]: input.decision
      };
    }
  });
  return bucket[input.conversationId]!;
}

/**
 * Drop review sessions with no pending rows and no live run manifest for
 * their optional `runId` (orphaned metadata after prune/delete).
 */
/** Move a conversation's review session to another workspace bucket. */
export async function migrateConversationReview(
  conversationId: string,
  fromWorkspaceId: string,
  toWorkspaceId: string
): Promise<void> {
  if (fromWorkspaceId === toWorkspaceId) return;
  const fromBucket = await loadBucket(fromWorkspaceId);
  const session = fromBucket[conversationId];
  if (!session) return;
  delete fromBucket[conversationId];
  await serialize(fromWorkspaceId, async () => {
    await persist(fromWorkspaceId, fromBucket);
    cache.set(fromWorkspaceId, fromBucket);
  });
  await upsertReviewSession(toWorkspaceId, {
    ...session,
    workspaceId: toWorkspaceId,
    conversationId
  });
  log.info('migrated review session on conversation move', {
    conversationId,
    fromWorkspaceId,
    toWorkspaceId
  });
}

export async function pruneOrphanedReviewSessions(workspaceId: string): Promise<number> {
  const bucket = await loadBucket(workspaceId);
  const runHeads = await listRunHeads(workspaceId);
  const liveRunIds = new Set(runHeads.map((h) => h.runId));
  const doomed: string[] = [];

  for (const conversationId of Object.keys(bucket)) {
    const session = bucket[conversationId]!;
    const pending = await listForConversation(conversationId, [workspaceId]);
    if (pending.length > 0) continue;
    if (session.runId && liveRunIds.has(session.runId)) continue;
    doomed.push(conversationId);
  }

  if (doomed.length === 0) return 0;

  await writeBucket(workspaceId, (draft) => {
    for (const cid of doomed) delete draft[cid];
  });
  log.info('pruned orphaned review sessions', { workspaceId, removed: doomed.length });
  return doomed.length;
}
