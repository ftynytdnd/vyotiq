import type { DisplayRow } from './projectSubagentRows.js';

export function isContextSummaryRow(
  row: DisplayRow
): row is Extract<DisplayRow, { kind: 'context-summary' }> {
  return row.kind === 'context-summary';
}

export function splitContextSummaryRows(rows: DisplayRow[]): {
  contextSummaryRows: Extract<DisplayRow, { kind: 'context-summary' }>[];
  inlineStreamRows: DisplayRow[];
} {
  const contextSummaryRows: Extract<DisplayRow, { kind: 'context-summary' }>[] = [];
  const inlineStreamRows: DisplayRow[] = [];

  for (const row of rows) {
    if (isContextSummaryRow(row)) {
      contextSummaryRows.push(row);
    } else {
      inlineStreamRows.push(row);
    }
  }

  return { contextSummaryRows, inlineStreamRows };
}
