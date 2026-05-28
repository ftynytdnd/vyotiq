/**
 * Stable key for sticky tail-follow scroll — row count plus tail growth proxy.
 */

import type { DiffStreamSnapshot } from '../reducer/types.js';
import type { DisplayRow } from './projectSubagentRows.js';

export function computeTailScrollKey(
  rows: DisplayRow[],
  assistantTexts: Record<string, { text: string }>,
  reasoningTexts: Record<string, { text: string }>,
  summaries: Record<string, { text: string }>,
  liveDiffByCallId: Record<string, DiffStreamSnapshot>
): string {
  if (rows.length === 0) return '0';
  const last = rows[rows.length - 1]!;
  let growth = 0;
  switch (last.kind) {
    case 'assistant-text':
      growth = assistantTexts[last.id]?.text.length ?? 0;
      break;
    case 'reasoning-line':
      growth = reasoningTexts[last.id]?.text.length ?? 0;
      break;
    case 'context-summary':
      growth = summaries[last.summaryId]?.text.length ?? 0;
      break;
    case 'tool-group':
      for (const child of last.children) {
        const diff = child.diffStream ?? liveDiffByCallId[child.callId];
        if (diff) {
          growth += diff.additions + diff.deletions + diff.hunks.length;
        }
        if (child.partial) growth += 1;
      }
      growth += last.children.length;
      break;
    case 'file-edit-group':
      for (const child of last.children) {
        growth += child.additions + child.deletions;
      }
      growth += last.children.length;
      break;
    default:
      break;
  }
  return `${rows.length}:${last.key}:${growth}`;
}
