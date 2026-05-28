/**
 * Collapse parallel sub-agent rows into one V5 delegate batch line.
 *
 * The orchestrator-level execution-plan stepper used to be injected
 * here (one card per delegate, rendered above the batch row). It was
 * removed because the same workers were already represented by the
 * expanded `DelegateBatchRow` immediately below — the duplication
 * crowded the timeline without adding navigation value. This module
 * now does one thing: walk the row stream and fold any consecutive
 * `subagent-line` runs into a single `delegate-batch` row.
 */

import type { Row } from '../reducer/deriveRows.js';

export type DisplayRow =
  | Row
  | { kind: 'delegate-batch'; key: string; subagentIds: string[] };

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

    if (batch.length >= 2) {
      out.push({
        kind: 'delegate-batch',
        key: `delegate:${batch.join(':')}`,
        subagentIds: batch
      });
    } else {
      for (const id of batch) {
        out.push({ kind: 'subagent-line', key: `sub:${id}`, subagentId: id });
      }
    }
  }

  return out;
}
