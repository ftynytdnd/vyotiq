/**
 * Heuristics for detecting binary / non-textual diffs in the preview pane.
 */

import type { DiffHunk } from '@shared/types/tool.js';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i;

export function isLikelyImagePath(path: string): boolean {
  return IMAGE_EXT.test(path);
}

/** True when diff lines look like UTF-8 binary decoded as replacement characters. */
export function looksLikeBinaryHunks(hunks: DiffHunk[]): boolean {
  let addedChars = 0;
  let replacement = 0;
  let control = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== '+') continue;
      for (const ch of line.text) {
        addedChars++;
        if (ch === '\uFFFD') replacement++;
        else if (ch < ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') control++;
      }
    }
  }
  if (addedChars < 48) return false;
  if (replacement / addedChars > 0.02) return true;
  if (control / addedChars > 0.08) return true;
  return false;
}
