/**
 * Collapse parallel sub-agent rows into one inline group container.
 *
 * Walks the row stream and folds any consecutive `subagent-line` runs into
 * a single `subagent-group` row that renders N manually-expandable traces.
 */

import type { Row } from '../reducer/deriveRows.js';

export type DisplayRow =
  | Row
  | { kind: 'subagent-group'; key: string; subagentIds: string[] };

export function projectSubagentRows(rows: Row[]): DisplayRow[] {
  const out: DisplayRow[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i]!;
    if (row.kind !== 'subagent-line') {
      out.push(row);
      i++;
      continue;
    }

    const batch: string[] = [];
    while (i < rows.length && rows[i]!.kind === 'subagent-line') {
      batch.push((rows[i] as Extract<Row, { kind: 'subagent-line' }>).subagentId);
      i++;
    }

    if (batch.length >= 1) {
      out.push({
        kind: 'subagent-group',
        key: `subagent-group:${batch.join(':')}`,
        subagentIds: batch
      });
    }
  }

  return out;
}
