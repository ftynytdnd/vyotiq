/**
 * Turn zone partitioner — classifies derived rows into prompt / agent stream / footer.
 */

import type { DisplayRow, AgentStreamRow } from './displayRowTypes.js';

export interface PartitionedTurn {
  prompt: DisplayRow | null;
  footer: DisplayRow[];
  /** Agent-side rows in render order (excludes prompt + footer). */
  agentStream: AgentStreamRow[];
}

const FOOTER_KINDS = new Set(['run-complete', 'error']);

export function partitionTurnSegment(segment: DisplayRow[]): PartitionedTurn {
  let prompt: DisplayRow | null = null;
  const footer: DisplayRow[] = [];
  const agentStream: DisplayRow[] = [];

  for (const row of segment) {
    if (row.kind === 'user-prompt') {
      prompt = row;
      continue;
    }
    if (FOOTER_KINDS.has(row.kind)) {
      footer.push(row);
      continue;
    }
    agentStream.push(row);
  }

  return { prompt, footer, agentStream };
}
