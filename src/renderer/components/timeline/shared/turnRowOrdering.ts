/**
 * Within-turn stable row ordering — activity → assistant-text → footer.
 * Shared by deriveRows (Row[]) and the renderer partitioner (DisplayRow[]).
 */

export function reorderTurnSegment<T extends { kind: string }>(segment: T[]): T[] {
  if (segment.length === 0) return segment;

  const promptRows: T[] = [];
  const activityRows: T[] = [];
  const responseRows: T[] = [];
  const footerRows: T[] = [];
  let pastPrompt = false;

  const footerKinds = new Set(['run-complete', 'token-budget-warning', 'error']);

  for (const row of segment) {
    if (row.kind === 'user-prompt') {
      promptRows.push(row);
      pastPrompt = true;
      continue;
    }
    if (!pastPrompt) {
      promptRows.push(row);
      continue;
    }
    if (row.kind === 'assistant-text') {
      responseRows.push(row);
    } else if (footerKinds.has(row.kind)) {
      footerRows.push(row);
    } else {
      activityRows.push(row);
    }
  }

  return [...promptRows, ...activityRows, ...responseRows, ...footerRows];
}

export function reorderRowsWithinTurns<T extends { kind: string }>(rows: T[]): T[] {
  const out: T[] = [];
  let current: T[] = [];

  for (const row of rows) {
    if (row.kind === 'user-prompt' && current.length > 0) {
      out.push(...reorderTurnSegment(current));
      current = [row];
    } else {
      current.push(row);
    }
  }

  if (current.length > 0) {
    out.push(...reorderTurnSegment(current));
  }

  return out;
}
