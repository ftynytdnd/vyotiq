/**
 * Resolve the active pending `ask-user-prompt` from the timeline tail.
 */

import type { TimelineEvent } from '@shared/types/chat.js';

export type PendingAskUserEvent = Extract<TimelineEvent, { kind: 'ask-user-prompt' }>;

export function findPendingAskUserEvent(
  events: TimelineEvent[],
  awaitingAskUser: boolean
): PendingAskUserEvent | null {
  if (!awaitingAskUser || events.length === 0) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind !== 'ask-user-prompt') continue;
    if (e.status === 'submitted') return null;
    return e;
  }
  return null;
}
