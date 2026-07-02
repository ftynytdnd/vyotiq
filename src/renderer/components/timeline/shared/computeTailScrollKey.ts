/**
 * Stable key for sticky tail-follow scroll — row count plus tail growth proxy.
 */

import type { DiffStreamSnapshot, LiveToolOutputSnapshot } from '../reducer/types.js';
import type { DisplayRow } from './displayRowTypes.js';

export function computeTailScrollKey(
  rows: DisplayRow[],
  assistantTexts: Record<string, { text: string }>,
  reasoningTexts: Record<string, { text: string }>,
  liveDiffByCallId: Record<string, DiffStreamSnapshot>,
  liveToolOutputByCallId: Record<string, LiveToolOutputSnapshot> = {}
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
    case 'tool-group':
      for (const child of last.children) {
        const diff = child.diffStream ?? liveDiffByCallId[child.callId];
        if (diff) {
          growth += diff.additions + diff.deletions + diff.hunks.length;
        }
        if (child.partial) growth += 1;
        const live = child.liveOutput ?? liveToolOutputByCallId[child.callId];
        if (live) growth += live.stdout.length + live.stderr.length;
      }
      growth += last.children.length;
      break;
    case 'file-edit-card': {
      let lineCount = 0;
      if (last.hunks) {
        for (const hunk of last.hunks) {
          lineCount += hunk.lines.length;
        }
      }
      growth += last.additions + last.deletions + lineCount * 8;
      if (last.phase === 'streaming') growth += 96;
      if (last.phase === 'settling') growth += 48;
      break;
    }
    case 'file-edit-pending':
      growth += 32;
      break;
    case 'ask-user-prompt':
      growth += 120;
      break;
    default:
      break;
  }
  return `${rows.length}:${last.key}:${growth}`;
}
