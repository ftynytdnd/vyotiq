/**
 * Renders a parallel delegation batch: summary line, optional collapse when
 * settled, and per-worker mini-threads (queued workers count in summary only).
 */

import type { ReactNode } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { useActiveConversationId } from '../../../store/useConversationsStore.js';
import { useTimelineUiStore } from '../../../store/useTimelineUiStore.js';
import { DelegationBatchSummary } from './DelegationBatchSummary.js';
import type { DelegationStreamSegment } from './segmentDelegationStream.js';
import {
  delegationBatchRowKey,
  isDelegationBatchSettled,
  isWorkerCardVisible
} from './delegationBatchIds.js';

interface DelegationConcurrentGroupProps {
  batchId: string | undefined;
  batchSubagentIds: readonly string[];
  groupKey: string;
  live?: boolean;
  segments: readonly DelegationStreamSegment[];
  workerSegmentIndices: readonly number[];
  renderWorkerSegment: (segmentIndex: number) => ReactNode;
}

export function DelegationConcurrentGroup({
  batchId,
  batchSubagentIds,
  groupKey,
  live = false,
  segments,
  workerSegmentIndices,
  renderWorkerSegment
}: DelegationConcurrentGroupProps) {
  const subagents = useChatStore((s) => s.subagents);
  const conversationId = useActiveConversationId();
  const batchKey = batchId ? delegationBatchRowKey(batchId) : `delegation-group:${groupKey}`;
  const expanded = useTimelineUiStore((s) => s.isExpanded(conversationId, batchKey));
  const toggle = useTimelineUiStore((s) => s.toggle);
  const settled = isDelegationBatchSettled(batchSubagentIds, subagents);
  const showSummary = batchSubagentIds.length >= 2;
  const collapsed = settled && !expanded && !live;
  const batchExpanded = !collapsed;

  const visibleSegmentIndices = workerSegmentIndices.filter((idx) => {
    const seg = segments[idx];
    return (
      seg?.kind === 'worker' &&
      isWorkerCardVisible(subagents, seg.subagentId, batchExpanded)
    );
  });

  return (
    <div
      className="vx-timeline-deleg-concurrent flex flex-col gap-2"
      data-delegation-concurrent="true"
      data-delegation-batch-id={batchId}
      data-delegation-settled={settled ? 'true' : undefined}
      data-delegation-collapsed={collapsed ? 'true' : undefined}
    >
      {showSummary ? (
        <DelegationBatchSummary subagentIds={batchSubagentIds} live={live} />
      ) : null}
      {collapsed ? (
        <button
          type="button"
          className="self-start vx-btn vx-btn-quiet px-1.5 py-0.5 text-chat-meta"
          onClick={() => {
            if (conversationId) toggle(conversationId, batchKey);
          }}
          aria-expanded={false}
        >
          Show {batchSubagentIds.length} workers
        </button>
      ) : (
        visibleSegmentIndices.map((idx) => renderWorkerSegment(idx))
      )}
    </div>
  );
}
