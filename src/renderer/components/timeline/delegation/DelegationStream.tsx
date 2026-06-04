/**
 * Inline delegation — orchestrator rows plus indented worker mini-threads.
 */

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import type { DisplayRow } from '../shared/projectSubagentRows.js';
import { segmentDelegationStream } from './segmentDelegationStream.js';
import type { DelegationStreamSegment } from './segmentDelegationStream.js';
import { DelegationWorker } from './DelegationWorker.js';
import { DelegationConcurrentGroup } from './DelegationConcurrentGroup.js';
import { subagentIdsForDelegationBatch } from './delegationBatchIds.js';

interface DelegationStreamProps {
  rows: DisplayRow[];
  renderRow: (row: DisplayRow) => ReactNode;
  live?: boolean;
}

function buildConcurrentGroupMap(
  segments: DelegationStreamSegment[],
  subagents: ReturnType<typeof useChatStore.getState>['subagents']
): Map<number, string> {
  const map = new Map<number, string>();
  let run: number[] = [];
  let groupSeq = 0;
  let currentBatchId: string | undefined;

  const flushRun = () => {
    if (run.length < 2) {
      run = [];
      currentBatchId = undefined;
      return;
    }
    const gid = String(groupSeq++);
    for (const i of run) map.set(i, gid);
    run = [];
    currentBatchId = undefined;
  };

  segments.forEach((seg, i) => {
    if (seg.kind === 'worker') {
      const batchId = subagents[seg.subagentId]?.delegationBatchId;
      if (run.length > 0 && batchId && batchId !== currentBatchId) {
        flushRun();
      }
      if (batchId) currentBatchId = batchId;
      run.push(i);
    } else {
      flushRun();
    }
  });
  flushRun();
  return map;
}

function resolveBatchSubagentIds(
  segments: DelegationStreamSegment[],
  groupIndices: number[],
  subagents: ReturnType<typeof useChatStore.getState>['subagents']
): { batchId: string | undefined; ids: string[] } {
  const fromSegments = groupIndices
    .map((idx) => {
      const seg = segments[idx];
      return seg?.kind === 'worker' ? seg.subagentId : undefined;
    })
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const batchId =
    fromSegments.length > 0 ? subagents[fromSegments[0]!]?.delegationBatchId : undefined;
  const ids =
    batchId !== undefined
      ? subagentIdsForDelegationBatch(batchId, subagents)
      : fromSegments;
  return { batchId, ids };
}

export function DelegationStream({ rows, renderRow, live = false }: DelegationStreamProps) {
  const segments = useMemo(() => segmentDelegationStream(rows), [rows]);
  const subagents = useChatStore((s) => s.subagents);

  const concurrentByIndex = useMemo(
    () => buildConcurrentGroupMap(segments, subagents),
    [segments, subagents]
  );

  const renderWorkerSegment = (seg: DelegationStreamSegment, index: number) => {
    if (seg.kind !== 'worker') return null;
    return (
      <DelegationWorker
        key={`worker:${seg.subagentId}:${seg.rows[0]?.key ?? index}`}
        subagentId={seg.subagentId}
        rows={seg.rows}
        renderRow={renderRow}
        live={live}
      />
    );
  };

  const elements: ReactNode[] = [];
  let i = 0;
  while (i < segments.length) {
    const gid = concurrentByIndex.get(i);
    if (gid) {
      const groupIndices: number[] = [];
      while (i < segments.length && concurrentByIndex.get(i) === gid) {
        groupIndices.push(i);
        i++;
      }
      const { batchId, ids: batchSubagentIds } = resolveBatchSubagentIds(
        segments,
        groupIndices,
        subagents
      );
      elements.push(
        <DelegationConcurrentGroup
          key={`concurrent:${gid}:${batchId ?? ''}`}
          batchId={batchId}
          batchSubagentIds={batchSubagentIds}
          groupKey={gid}
          live={live}
          segments={segments}
          workerSegmentIndices={groupIndices}
          renderWorkerSegment={(idx) => {
            const seg = segments[idx];
            if (!seg) return null;
            return renderWorkerSegment(seg, idx);
          }}
        />
      );
    } else {
      const seg = segments[i]!;
      if (seg.kind === 'orchestrator') {
        elements.push(
          <div key={`orch:${i}:${seg.rows[0]?.key ?? ''}`}>
            {seg.rows.map((row) => (
              <div key={row.key}>{renderRow(row)}</div>
            ))}
          </div>
        );
      } else {
        elements.push(renderWorkerSegment(seg, i));
      }
      i++;
    }
  }

  return <div className="vx-timeline-deleg-stream flex flex-col gap-2">{elements}</div>;
}
