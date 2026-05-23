/**
 * Scroll the timeline to a sub-agent row and expand it inline.
 */

import type { SubAgentSnapshot } from '../reducer/types.js';

export function pickLatestSubagentId(
  subagents: Record<string, SubAgentSnapshot>
): string | null {
  let latestId: string | null = null;
  let latestStartedAt = Number.NEGATIVE_INFINITY;
  for (const sa of Object.values(subagents)) {
    if (sa.startedAt >= latestStartedAt) {
      latestStartedAt = sa.startedAt;
      latestId = sa.id;
    }
  }
  return latestId;
}

export function scrollToSubagentRow(subagentId: string): void {
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-subagent-id="${subagentId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}
