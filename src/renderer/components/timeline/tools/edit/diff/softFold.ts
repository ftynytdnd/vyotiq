/**
 * Soft-fold runs of unchanged context lines inside a diff hunk so a
 * 200-line hunk with two real edits doesn't visually drown the
 * actual changes. The fold is non-destructive — every original line
 * is still reachable via the per-fold "expand" affordance.
 *
 * Heuristic:
 *   - Any contiguous run of ` ` (context) lines longer than `cap`
 *     becomes one foldable region. The first `head` lines and the
 *     last `tail` lines are kept visible as anchors; the middle
 *     `run.length - head - tail` lines fold behind a single
 *     "… N unchanged lines — expand" placeholder.
 *   - Runs at the very start/end of a hunk (no `+`/`-` neighbour on
 *     one side) shrink to ONLY the side that has a neighbour, since
 *     a "leading" fold near the file head reads as noise.
 *
 * Pure / no React imports — safe inside `useMemo` and unit tests.
 */

import type { DiffLine } from '@shared/types/tool.js';

export type FoldedItem =
  | { kind: 'line'; line: DiffLine; lineIndex: number }
  | { kind: 'fold'; foldId: string; hidden: number; firstLineIndex: number; lastLineIndex: number };

export interface SoftFoldOptions {
  /** Minimum context-run length to trigger a fold. Defaults to 7. */
  cap?: number;
  /** Lines kept visible at the top of the run. Defaults to 3. */
  head?: number;
  /** Lines kept visible at the bottom of the run. Defaults to 3. */
  tail?: number;
}

/**
 * Build the visual sequence of items the renderer walks. Each
 * `kind: 'line'` carries the original `lineIndex` so the consumer
 * can keep the existing intra-line highlight map keyed by index.
 */
export function buildFoldedItems(
  lines: readonly DiffLine[],
  hunkIdx: number,
  expandedFolds: ReadonlySet<string>,
  opts: SoftFoldOptions = {}
): FoldedItem[] {
  const cap = Math.max(1, opts.cap ?? 7);
  const head = Math.max(0, opts.head ?? 3);
  const tail = Math.max(0, opts.tail ?? 3);

  const out: FoldedItem[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.kind !== ' ') {
      out.push({ kind: 'line', line, lineIndex: i });
      i++;
      continue;
    }
    // Walk the contiguous context run.
    let j = i;
    while (j < lines.length && lines[j]!.kind === ' ') j++;
    const runLen = j - i;
    const isLeading = i === 0;
    const isTrailing = j === lines.length;

    if (runLen <= cap) {
      for (let k = i; k < j; k++) {
        out.push({ kind: 'line', line: lines[k]!, lineIndex: k });
      }
      i = j;
      continue;
    }

    // Edge runs only need the side that abuts a +/- region; trim the
    // far side to avoid showing context that's unrelated to any edit.
    const effHead = isLeading ? 0 : head;
    const effTail = isTrailing ? 0 : tail;
    const visibleAtEdges = effHead + effTail;
    if (visibleAtEdges >= runLen) {
      // After trimming the inert edge side, the visible window is
      // already wider than the run itself — no fold to insert.
      for (let k = i; k < j; k++) {
        out.push({ kind: 'line', line: lines[k]!, lineIndex: k });
      }
      i = j;
      continue;
    }

    const foldId = `h${hunkIdx}:${i}-${j - 1}`;
    if (expandedFolds.has(foldId)) {
      for (let k = i; k < j; k++) {
        out.push({ kind: 'line', line: lines[k]!, lineIndex: k });
      }
      i = j;
      continue;
    }

    for (let k = i; k < i + effHead; k++) {
      out.push({ kind: 'line', line: lines[k]!, lineIndex: k });
    }
    out.push({
      kind: 'fold',
      foldId,
      hidden: runLen - visibleAtEdges,
      firstLineIndex: i + effHead,
      lastLineIndex: j - effTail - 1
    });
    for (let k = j - effTail; k < j; k++) {
      out.push({ kind: 'line', line: lines[k]!, lineIndex: k });
    }
    i = j;
  }

  return out;
}
