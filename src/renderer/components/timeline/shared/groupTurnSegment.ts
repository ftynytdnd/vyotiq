/**
 * Turn zone partitioner — classifies derived rows into prompt / activity /
 * response / footer zones and activity sub-categories for lane rendering.
 */

import type { DisplayRow } from './projectSubagentRows.js';
import { reorderTurnSegment } from './turnRowOrdering.js';

export type TurnZone = 'prompt' | 'activity' | 'response' | 'footer';

export type ActivityCategory = 'reasoning' | 'tools' | 'delegates' | 'status';

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

const FOOTER_KINDS = new Set(['run-complete', 'token-budget-warning', 'error']);

export { reorderTurnSegment, reorderRowsWithinTurns } from './turnRowOrdering.js';

/** Duration for "Worked for Xs" — run-complete first, else max reasoning span. */
export function resolveTurnActivityDurationMs(
  partitioned: PartitionedTurn,
  reasoningSpans?: Record<string, { startedAt: number; endedAt?: number }>
): number {
  const runComplete = partitioned.footer.find((r) => r.kind === 'run-complete');
  if (runComplete?.kind === 'run-complete' && runComplete.durationMs > 0) {
    return runComplete.durationMs;
  }
  if (!reasoningSpans) return 0;

  let span = 0;
  for (const row of partitioned.activity) {
    if (row.kind !== 'reasoning-line') continue;
    const acc = reasoningSpans[row.id];
    if (!acc) continue;
    const end = acc.endedAt ?? acc.startedAt;
    span = Math.max(span, Math.max(0, end - acc.startedAt));
  }
  return span;
}

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

export function categorizeActivityRow(row: DisplayRow): ActivityCategory {
  switch (row.kind) {
    case 'reasoning-line':
      return 'reasoning';
    case 'tool-group':
    case 'file-edit-group':
      return 'tools';
    case 'subagent-line':
    case 'delegate-batch':
      return 'delegates';
    case 'agent-thought':
    case 'phase':
    case 'context-summary':
      return 'status';
    default:
      return 'status';
  }
}

export const ACTIVITY_CATEGORY_ORDER: readonly ActivityCategory[] = [
  'reasoning',
  'tools',
  'delegates',
  'status'
] as const;

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  reasoning: 'Reasoning',
  tools: 'Tools',
  delegates: 'Delegates',
  status: 'Status'
};

/** Group activity rows by category, preserving relative order within each. */
export function groupActivityByCategory(
  rows: DisplayRow[]
): Record<ActivityCategory, DisplayRow[]> {
  const grouped: Record<ActivityCategory, DisplayRow[]> = {
    reasoning: [],
    tools: [],
    delegates: [],
    status: []
  };

  for (const row of rows) {
    grouped[categorizeActivityRow(row)].push(row);
  }

  return grouped;
}

/** Resolve run id for turn-activity ui-store key (prompt runId or prompt id). */
export function turnActivityStoreKey(partitioned: PartitionedTurn): string | null {
  if (partitioned.prompt?.kind !== 'user-prompt') return null;
  const { runId, id } = partitioned.prompt;
  return runId && runId.length > 0 ? runId : id;
}
