import type { ReviewDecision, ReviewSession } from '../types/checkpoint.js';

/** True when review metadata blocks send (request changes). */
export function reviewSessionBlocksSend(session: ReviewSession): boolean {
  if (session.decision === 'request_changes') return true;
  const perFile = session.fileDecisions ?? {};
  return Object.values(perFile).some((d) => d === 'request_changes');
}

/** Per-file or overall review decision for pending row badges. */
export function fileReviewDecision(
  session: ReviewSession | null | undefined,
  filePath: string
): ReviewDecision | undefined {
  if (!session) return undefined;
  return session.fileDecisions?.[filePath] ?? session.decision;
}
