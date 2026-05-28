/**
 * Review-mode line anchor passed from diff gutter clicks.
 * Uses the post-change (new) line when present, else pre-delete line.
 */

export interface DiffLinePick {
  newLine: number | null;
  oldLine: number | null;
}

/** 1-based line number stored on review comments. */
export function pickAnchorLine(pick: DiffLinePick): number | null {
  if (pick.newLine !== null && pick.newLine > 0) return pick.newLine;
  if (pick.oldLine !== null && pick.oldLine > 0) return pick.oldLine;
  return null;
}

export interface ReviewLinePickProps {
  highlightLine: number | null;
  onPick: (line: number) => void;
}
