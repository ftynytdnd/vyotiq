import type { FileReviewComment, ReviewSession } from '../types/checkpoint.js';

export type ReviewImportMode = 'merge' | 'replace';

/** True when the session carries review metadata beyond an empty shell. */
export function reviewSessionHasContent(session: ReviewSession): boolean {
  if (session.comments.length > 0) return true;
  if (session.reviewerLabel?.trim()) return true;
  if (session.decision) return true;
  if (session.fileDecisions && Object.keys(session.fileDecisions).length > 0) return true;
  if (session.gitBaseRef?.trim()) return true;
  return false;
}

export function mergeReviewComments(
  existing: readonly FileReviewComment[],
  incoming: readonly FileReviewComment[],
  reassignId: () => string
): FileReviewComment[] {
  const used = new Set(existing.map((c) => c.id));
  const merged: FileReviewComment[] = [...existing];
  for (const comment of incoming) {
    let id = comment.id;
    if (used.has(id)) id = reassignId();
    used.add(id);
    merged.push({ ...comment, id });
  }
  return merged.sort((a, b) => a.ts - b.ts);
}

/** Combine local review metadata with an imported session for one conversation. */
export function mergeReviewSessions(
  existing: ReviewSession,
  incoming: ReviewSession,
  target: { conversationId: string; workspaceId: string },
  reassignId: () => string
): ReviewSession {
  const fileDecisions = {
    ...(existing.fileDecisions ?? {}),
    ...(incoming.fileDecisions ?? {})
  };
  const comments = mergeReviewComments(existing.comments, incoming.comments, reassignId);

  return {
    conversationId: target.conversationId,
    workspaceId: target.workspaceId,
    runId: existing.runId ?? incoming.runId,
    startedAt: Math.min(existing.startedAt, incoming.startedAt),
    updatedAt: Date.now(),
    comments,
    decision: incoming.decision ?? existing.decision,
    ...(Object.keys(fileDecisions).length > 0 ? { fileDecisions } : {}),
    ...(incoming.gitBaseRef?.trim()
      ? { gitBaseRef: incoming.gitBaseRef }
      : existing.gitBaseRef?.trim()
        ? { gitBaseRef: existing.gitBaseRef }
        : {}),
    ...(incoming.reviewerLabel?.trim()
      ? { reviewerLabel: incoming.reviewerLabel }
      : existing.reviewerLabel?.trim()
        ? { reviewerLabel: existing.reviewerLabel }
        : {})
  };
}

/** Incoming session normalized for the target conversation (replace path). */
export function normalizeImportedSession(
  incoming: ReviewSession,
  target: { conversationId: string; workspaceId: string }
): ReviewSession {
  return {
    ...incoming,
    conversationId: target.conversationId,
    workspaceId: target.workspaceId,
    updatedAt: Date.now()
  };
}
