/**
 * Build a card-friendly line sequence from unified diff hunks — changed
 * lines plus one line of anchor context, with folds for skipped runs.
 */

import type { DiffHunk, DiffLine } from '@shared/types/tool.js';

export type SnippetItem =
  | { kind: 'line'; line: DiffLine; lineIndex: number; hunkIdx: number }
  | { kind: 'fold'; foldId: string; hidden: number };

const CONTEXT_PAD = 1;
const MAX_VISIBLE_LINES = 160;

function indicesNearChanges(lines: readonly DiffLine[]): Set<number> {
  const include = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.kind === ' ') continue;
    for (
      let j = Math.max(0, i - CONTEXT_PAD);
      j <= Math.min(lines.length - 1, i + CONTEXT_PAD);
      j++
    ) {
      include.add(j);
    }
  }
  return include;
}

function itemsForHunk(
  hunk: DiffHunk,
  hunkIdx: number,
  expandedFolds: ReadonlySet<string>
): SnippetItem[] {
  const include = indicesNearChanges(hunk.lines);
  if (include.size === 0) return [];

  const sorted = [...include].sort((a, b) => a - b);
  const out: SnippetItem[] = [];

  for (let s = 0; s < sorted.length; s++) {
    const idx = sorted[s]!;
    const prev = s > 0 ? sorted[s - 1]! : -1;
    if (prev >= 0 && idx - prev > 1) {
      const hidden = idx - prev - 1;
      const foldId = `${hunkIdx}:${prev + 1}:${idx - 1}`;
      if (expandedFolds.has(foldId)) {
        for (let k = prev + 1; k < idx; k++) {
          out.push({
            kind: 'line',
            line: hunk.lines[k]!,
            lineIndex: k,
            hunkIdx
          });
        }
      } else {
        out.push({ kind: 'fold', foldId, hidden });
      }
    }
    out.push({
      kind: 'line',
      line: hunk.lines[idx]!,
      lineIndex: idx,
      hunkIdx
    });
  }

  return out;
}

export interface SnippetBuildResult {
  items: SnippetItem[];
  hiddenLineCount: number;
}

export function buildSnippetItems(
  hunks: readonly DiffHunk[],
  expandedFolds: ReadonlySet<string>
): SnippetBuildResult {
  const items: SnippetItem[] = [];
  let rendered = 0;
  let hiddenLineCount = 0;

  for (let h = 0; h < hunks.length; h++) {
    const hunkItems = itemsForHunk(hunks[h]!, h, expandedFolds);
    for (const item of hunkItems) {
      if (item.kind === 'line') {
        if (rendered >= MAX_VISIBLE_LINES) {
          hiddenLineCount++;
          continue;
        }
        rendered++;
      }
      items.push(item);
    }
  }

  return { items, hiddenLineCount };
}

/** Plain-text export of changed lines only (for clipboard). */
export function hunksToChangedSnippet(hunks: readonly DiffHunk[]): string {
  const out: string[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === ' ') continue;
      out.push(`${line.kind}${line.text}`);
    }
  }
  return out.join('\n');
}

export function findLastChangedLineIndex(hunks: readonly DiffHunk[]): number | null {
  let last: number | null = null;
  let offset = 0;
  for (const hunk of hunks) {
    for (let i = 0; i < hunk.lines.length; i++) {
      if (hunk.lines[i]!.kind !== ' ') last = offset + i;
    }
    offset += hunk.lines.length;
  }
  return last;
}
