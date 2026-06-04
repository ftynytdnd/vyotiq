/**
 * Word-level intra-line highlight builder for adjacent `-` / `+`
 * line pairs in a diff hunk. Pure helpers (kept out of the React
 * tree on purpose) consumed by `DiffHunk` via `useMemo`.
 *
 * Strategy: split on the longest common prefix and longest common
 * suffix of two adjacent lines. The middle becomes the "changed"
 * span — the dominant idiom in modern diff viewers (Linear,
 * GitHub side-by-side, and similar).
 *
 * Cost: `O(min(|a|, |b|))` per pair; cheap enough to run inline
 * for every hunk on every render. The map is keyed by visible
 * line index so the row renderer can resolve its own split in `O(1)`.
 */

import type { DiffLine } from '@shared/types/tool.js';

export interface IntraLineHighlight {
  prefix: string;
  changed: string;
  suffix: string;
}

export interface IntraLinePair {
  old: IntraLineHighlight;
  new: IntraLineHighlight;
}

/**
 * Word-level diff between two adjacent `-` / `+` lines.
 *
 * Returns `null` when the lines differ too much for word-level
 * highlighting to be useful (heuristic: both prefix and suffix
 * lengths are 0 — i.e. the lines share no common edge characters,
 * so the line-level stain reads more clearly than a "changed: <whole
 * line>" span).
 */
export function intraLineDiff(oldText: string, newText: string): IntraLinePair | null {
  const a = oldText;
  const b = newText;

  let pre = 0;
  const maxPre = Math.min(a.length, b.length);
  while (pre < maxPre && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++;

  let suf = 0;
  const maxSuf = Math.min(a.length - pre, b.length - pre);
  while (
    suf < maxSuf &&
    a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf)
  ) {
    suf++;
  }

  if (pre === 0 && suf === 0) return null;

  return {
    old: {
      prefix: a.slice(0, pre),
      changed: a.slice(pre, a.length - suf),
      suffix: a.slice(a.length - suf)
    },
    new: {
      prefix: b.slice(0, pre),
      changed: b.slice(pre, b.length - suf),
      suffix: b.slice(b.length - suf)
    }
  };
}

/**
 * Walk a hunk's visible lines and pair adjacent `-` / `+` lines for
 * intra-line word highlighting. Each pair contributes TWO entries to
 * the map — the `-` line's index and the `+` line's index — so the
 * row renderer can look up its own split in `O(1)`.
 *
 * `streamingTipIdx` is the index of the line currently being
 * streamed. When non-negative, that line is excluded from pairing —
 * its bytes are still arriving and intra-line word highlights on a
 * truncated line would flicker on every delta. The line's
 * counterpart in the pair is also excluded so we never partial-
 * highlight one side of a pair against a stale tip.
 *
 * Lines without a paired counterpart (lone `-`, lone `+`, or any
 * ` ` context line) get no entry and fall back to the line-level
 * stain.
 */
export function buildIntraLineMap(
  lines: readonly DiffLine[],
  streamingTipIdx = -1
): Map<number, IntraLineHighlight> {
  const out = new Map<number, IntraLineHighlight>();
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i]!;
    const b = lines[i + 1]!;
    if (a.kind !== '-' || b.kind !== '+') continue;
    if (streamingTipIdx === i || streamingTipIdx === i + 1) {
      // Skip the streaming tip pair entirely; the cursor + plain
      // text rendering carries the in-flight signal.
      i++;
      continue;
    }
    const pair = intraLineDiff(a.text, b.text);
    if (!pair) continue;
    out.set(i, pair.old);
    out.set(i + 1, pair.new);
    // Skip the `+` we just paired so a pathological `-+ -+` block
    // doesn't pair across the boundary.
    i++;
  }
  return out;
}

/** Index of the last `+` / `-` line in a hunk — the streaming tip. */
export function findLastStreamingLineIdx(
  lines: readonly { kind: string }[]
): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const k = lines[i]?.kind;
    if (k === '+' || k === '-') return i;
  }
  return -1;
}
