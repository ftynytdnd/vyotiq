/**
 * Turn zone partitioner — classifies derived rows into prompt / activity /
 * response / footer zones for the timeline turn block.
 */

import type { DisplayRow } from './displayRowTypes.js';
import { reorderTurnSegment } from './turnRowOrdering.js';

export interface PartitionedTurn {
  prompt: DisplayRow | null;
  activity: DisplayRow[];
  response: DisplayRow | null;
  footer: DisplayRow[];
  /** Agent-side rows in render order (excludes prompt + footer). */
  agentStream: DisplayRow[];
}

export interface PartitionTurnOptions {
  /** When false, legacy activity→response reorder (default: wire order). */
  chronological?: boolean;
}

const FOOTER_KINDS = new Set(['run-complete', 'error']);

export { reorderTurnSegment } from './turnRowOrdering.js';

export function partitionTurnSegment(
  segment: DisplayRow[],
  opts?: PartitionTurnOptions
): PartitionedTurn {
  // Default to wire order — inline stream renders rows as they occurred.
  const ordered = opts?.chronological === false ? reorderTurnSegment(segment) : segment;
  let prompt: DisplayRow | null = null;
  let response: DisplayRow | null = null;
  const activity: DisplayRow[] = [];
  const footer: DisplayRow[] = [];
  const agentStream: DisplayRow[] = [];

  for (const row of ordered) {
    if (row.kind === 'user-prompt') {
      prompt = row;
      continue;
    }
    if (FOOTER_KINDS.has(row.kind)) {
      footer.push(row);
      continue;
    }
    agentStream.push(row);
    if (row.kind === 'assistant-text') {
      if (!response) response = row;
    } else {
      activity.push(row);
    }
  }

  return { prompt, activity, response, footer, agentStream };
}
