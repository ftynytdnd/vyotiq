/**
 * Inline delegation stream grouped by worker.
 */

import type { ReactNode } from 'react';
import type { DisplayRow } from '../shared/projectSubagentRows.js';
import { segmentDelegationStream } from './segmentDelegationStream.js';
import { StreamWeaveWorker } from './StreamWeaveWorker.js';
import { workerTagFromIndex } from './delegationHelpers.js';

interface StreamWeaveStreamProps {
  rows: DisplayRow[];
  renderRow: (row: DisplayRow) => ReactNode;
  live?: boolean;
}

export function StreamWeaveStream({ rows, renderRow, live = false }: StreamWeaveStreamProps) {
  const segments = segmentDelegationStream(rows);
  const workerOrder = new Map<string, number>();
  let nextTag = 0;
  for (const seg of segments) {
    if (seg.kind === 'worker' && !workerOrder.has(seg.subagentId)) {
      workerOrder.set(seg.subagentId, nextTag++);
    }
  }

  return (
    <div className="vx-timeline-deleg-weave flex flex-col gap-2">
      <div className="vx-timeline-deleg-weave-flow flex flex-col gap-2.5">
        {segments.map((seg) => {
          if (seg.kind === 'orchestrator') {
            return seg.rows.map((row) => (
              <div key={row.key}>{renderRow(row)}</div>
            ));
          }
          const tagIndex = workerOrder.get(seg.subagentId) ?? 0;
          return (
            <StreamWeaveWorker
              key={`worker:${seg.subagentId}:${seg.rows[0]?.key ?? ''}`}
              subagentId={seg.subagentId}
              tag={workerTagFromIndex(tagIndex)}
              rows={seg.rows}
              renderRow={renderRow}
              live={live}
            />
          );
        })}
      </div>
    </div>
  );
}
