/**
 * Shared LCS-based unified-diff hunker.
 *
 * Single source of truth for line-level diff computation. Used by:
 *   - `src/main/tools/edit.tool.ts` and `src/main/tools/bash.tool.ts`
 *     for authoritative post-write diff inside their respective
 *     tools (direct import; the previous `editHelpers.ts` re-export
 *     wrapper was removed in the May 2026 audit cleanup).
 *   - `src/main/orchestrator/diffStreamer.ts` (Phase 2) for the
 *     incremental FS-aware streaming diff, both inline and via the
 *     off-main-thread `diffWorker` pool.
 *   - `@shared/text/diff/computeDiffHunks` (imported directly in renderer)
 *     for the Checkpoints / pending-changes diff against fetched blob
 *     bodies.
 *   - `src/renderer/components/timeline/tools/edit/synthesizeDiffPreview.ts`
 *     (Phase 1.2) for the renderer-side streaming preview when no FS
 *     body is available.
 *
 * Algorithm:
 *   - Standard LCS length-table walk, O(n·m) in line counts. Bounded
 *     by the read tool's 512 KB cap on each side, so worst case is
 *     ~131 K lines × 131 K lines ≈ 17 G ops which would obviously
 *     stall. In practice both tool inputs and on-disk files stay well
 *     under that — the partial-args preview path also only ever
 *     hands us the model's `oldString` / `newString` (typically a
 *     few dozen lines).
 *   - Hunks include up to `context` leading + `context` trailing
 *     unchanged lines; closely-spaced edits merge into a single hunk
 *     so we never emit two adjacent single-line hunks separated by
 *     a one-line gap.
 *
 * Pure function — no IO, no DOM, no React. Safe to import from any
 * runtime (main, renderer, worker thread).
 *
 * The DiffHunk / DiffLine wire shape lives in `@shared/types/tool` so
 * both ends of the IPC channel see identical structures.
 */

import type { DiffHunk, DiffLine } from '../../types/tool.js';

/** Default surrounding context lines per side, matching `git diff -U3`. */
export const DEFAULT_DIFF_CONTEXT = 3;

/**
 * Flat op result of an LCS line-diff walk.
 *
 *   - `lines`   — every `+` / `-` / ` ` op in stream order.
 *   - `oldNums` / `newNums` — 1-indexed line numbers in the
 *     `before` and `after` sides respectively, parallel to `lines`.
 *
 * Used by `computeDiffHunks` (segments these into hunks with
 * surrounding context) and by streaming consumers that want the
 * unsegmented diff (the renderer's `synthesizeDiffPreview` takes
 * this path so every line of the model's `oldString`/`newString`
 * stays visible — those bytes are the explicit anchors the agent
 * chose, not surrounding file context that should be hidden).
 */
export interface DiffOps {
  lines: DiffLine[];
  oldNums: number[];
  newNums: number[];
}

/**
 * Walk the LCS table for `before` vs `after` and emit the flat op
 * list. Pure helper — segmentation into hunks is a separate step.
 *
 * Algorithm: standard LCS length table + greedy back-walk, biased
 * toward `-` when the down-edge is at-least-as-long as the
 * right-edge. The bias keeps the trace deterministic for adjacent
 * edits (matters for the `synthesizeDiffPreview` test fixtures and
 * for the `EditInvocation` settle animation).
 */
export function computeDiffOps(before: string, after: string): DiffOps {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) lcs[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) lcs[i]![j] = (lcs[i + 1]![j + 1] ?? 0) + 1;
      else lcs[i]![j] = Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0);
    }
  }
  const lines: DiffLine[] = [];
  const oldNums: number[] = [];
  const newNums: number[] = [];
  let i = 0;
  let j = 0;
  let oi = 1;
  let nj = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ kind: ' ', text: a[i]! });
      oldNums.push(oi);
      newNums.push(nj);
      i++; j++; oi++; nj++;
    } else if ((lcs[i + 1]![j] ?? 0) >= (lcs[i]![j + 1] ?? 0)) {
      lines.push({ kind: '-', text: a[i]! });
      oldNums.push(oi);
      newNums.push(nj);
      i++; oi++;
    } else {
      lines.push({ kind: '+', text: b[j]! });
      oldNums.push(oi);
      newNums.push(nj);
      j++; nj++;
    }
  }
  while (i < n) {
    lines.push({ kind: '-', text: a[i]! });
    oldNums.push(oi);
    newNums.push(nj);
    i++; oi++;
  }
  while (j < m) {
    lines.push({ kind: '+', text: b[j]! });
    oldNums.push(oi);
    newNums.push(nj);
    j++; nj++;
  }
  return { lines, oldNums, newNums };
}

/**
 * Compute a unified-diff hunk array between `before` and `after`.
 *
 * Stable contract:
 *   - Splits both inputs on `\n`. CRLF should be normalised by the
 *     caller before calling this if a binary-identical match across
 *     line endings is required (the `edit` tool's `findFlexible`
 *     handles that on the main side).
 *   - Hunk `oldStart` / `newStart` are 1-indexed and reflect the
 *     position in the corresponding side's line array, including
 *     leading context lines.
 *   - Returns `[]` when the two inputs are identical at the line
 *     level. The caller decides whether to render an empty-state
 *     pane.
 *
 * @param before Original text body. Empty string is valid (means
 *               every line is an addition).
 * @param after  Desired text body. Empty string is valid (means
 *               every line is a deletion).
 * @param context Number of unchanged lines of context per side.
 *                Defaults to `DEFAULT_DIFF_CONTEXT` (3). Pass `0`
 *                with care: zero-context segmentation will truncate
 *                trailing changes that follow a single unchanged
 *                anchor line. Streaming consumers that want every
 *                line preserved should call `computeDiffOps` and
 *                wrap the flat result in a single `DiffHunk`
 *                instead (see `synthesizeDiffPreview`).
 */
export function computeDiffHunks(
  before: string,
  after: string,
  context = DEFAULT_DIFF_CONTEXT
): DiffHunk[] {
  const { lines: ops, oldNums, newNums } = computeDiffOps(before, after);

  // Walk the ops and slice out hunks around each change cluster. Each
  // hunk includes up to `context` leading + `context` trailing
  // unchanged lines, with the window expanded only when another
  // change lands within that trailing run (otherwise small edits
  // would pointlessly merge into one large hunk on dense files).
  const hunks: DiffHunk[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k]!.kind === ' ') { k++; continue; }
    // Back up by `context` unchanged lines, stopping at start-of-ops.
    const startK = Math.max(0, k - context);
    let endK = k;
    let trailing = 0;
    while (endK < ops.length) {
      if (ops[endK]!.kind === ' ') {
        trailing++;
        if (trailing >= context) {
          // Enough trailing context collected — look ahead to see if
          // another change starts within the NEXT `context` lines. If
          // so, keep walking so the hunks merge; otherwise stop here
          // with EXACTLY `context` trailing unchanged lines.
          let lookahead = endK + 1;
          let gap = 0;
          let foundChange = false;
          while (lookahead < ops.length && gap < context) {
            if (ops[lookahead]!.kind !== ' ') { foundChange = true; break; }
            gap++;
            lookahead++;
          }
          if (!foundChange) {
            endK++;
            break;
          }
        }
        endK++;
      } else {
        trailing = 0;
        endK++;
      }
    }
    const slice = ops.slice(startK, endK);
    hunks.push({
      oldStart: oldNums[startK] ?? 1,
      newStart: newNums[startK] ?? 1,
      lines: slice
    });
    k = endK;
  }
  return hunks;
}
