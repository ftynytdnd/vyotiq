/**
 * Bounded LCS diff for large bodies — windows around the edit region
 * instead of skipping or stalling on multi-megabyte files.
 */

import type { DiffHunk } from '../../types/tool.js';
import { computeDiffHunks } from './computeDiffHunks.js';

/** Full in-memory diff when combined bodies stay under this size. */
export const FULL_DIFF_MAX_CHARS = 1024 * 1024;

/** Target window size for chunked diff (each side). */
export const DIFF_WINDOW_TARGET_CHARS = 256 * 1024;

/** Context lines around the first/last change inside a window. */
const WINDOW_CONTEXT_LINES = 80;

export interface DiffWindowSlice {
  before: string;
  after: string;
  oldLineOffset: number;
  newLineOffset: number;
}

/**
 * Find the first and last line index where `before` and `after` differ.
 * Pads the shorter side with empty strings.
 */
function changeLineBounds(beforeLines: string[], afterLines: string[]): {
  first: number;
  last: number;
} | null {
  const max = Math.max(beforeLines.length, afterLines.length);
  let first = -1;
  let last = -1;
  for (let i = 0; i < max; i++) {
    const a = beforeLines[i] ?? '';
    const b = afterLines[i] ?? '';
    if (a === b) continue;
    if (first === -1) first = i;
    last = i;
  }
  if (first === -1) return null;
  return { first, last };
}

/**
 * Extract a line-bounded window around the edit region. Returns the
 * full strings when small enough; otherwise slices both sides.
 */
export function extractDiffWindow(
  before: string,
  after: string,
  targetChars = DIFF_WINDOW_TARGET_CHARS
): DiffWindowSlice {
  if (before.length + after.length <= FULL_DIFF_MAX_CHARS) {
    return { before, after, oldLineOffset: 0, newLineOffset: 0 };
  }

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const bounds = changeLineBounds(beforeLines, afterLines);

  if (!bounds) {
    const headBefore = before.slice(0, targetChars);
    const headAfter = after.slice(0, targetChars);
    return { before: headBefore, after: headAfter, oldLineOffset: 0, newLineOffset: 0 };
  }

  const start = Math.max(0, bounds.first - WINDOW_CONTEXT_LINES);
  const end = Math.min(
    Math.max(beforeLines.length, afterLines.length),
    bounds.last + WINDOW_CONTEXT_LINES + 1
  );

  const sliceBefore = beforeLines.slice(start, end).join('\n');
  const sliceAfter = afterLines.slice(start, end).join('\n');

  if (sliceBefore.length + sliceAfter.length <= targetChars * 2) {
    return {
      before: sliceBefore,
      after: sliceAfter,
      oldLineOffset: start,
      newLineOffset: start
    };
  }

  const mid = Math.floor((bounds.first + bounds.last) / 2);
  const halfLines = Math.max(20, Math.floor(WINDOW_CONTEXT_LINES / 2));
  const tightStart = Math.max(0, mid - halfLines);
  const tightEnd = Math.min(
    Math.max(beforeLines.length, afterLines.length),
    mid + halfLines + 1
  );

  return {
    before: beforeLines.slice(tightStart, tightEnd).join('\n'),
    after: afterLines.slice(tightStart, tightEnd).join('\n'),
    oldLineOffset: tightStart,
    newLineOffset: tightStart
  };
}

/** Shift hunk start lines by a window offset. */
export function offsetDiffHunks(
  hunks: DiffHunk[],
  oldLineOffset: number,
  newLineOffset: number
): DiffHunk[] {
  if (oldLineOffset === 0 && newLineOffset === 0) return hunks;
  return hunks.map((hunk) => ({
    ...hunk,
    oldStart: hunk.oldStart + oldLineOffset,
    newStart: hunk.newStart + newLineOffset
  }));
}

/**
 * Compute unified diff hunks, windowing large bodies around the edit
 * region so LCS stays bounded without skipping the stream entirely.
 */
export function computeDiffHunksBounded(before: string, after: string): DiffHunk[] {
  const window = extractDiffWindow(before, after);
  const hunks = computeDiffHunks(window.before, window.after);
  return offsetDiffHunks(hunks, window.oldLineOffset, window.newLineOffset);
}
