/**
 * One-line rollup for a parallel delegation batch (N workers, cap, queue).
 */

import { useMemo } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import {
  countDelegationBatch,
  formatDelegationBatchLabel
} from './delegationBatchCounts.js';

interface DelegationBatchSummaryProps {
  subagentIds: readonly string[];
  live?: boolean;
}

export function DelegationBatchSummary({
  subagentIds,
  live = false
}: DelegationBatchSummaryProps) {
  const subagents = useChatStore((s) => s.subagents);
  const label = useMemo(() => {
    const counts = countDelegationBatch(subagentIds, subagents);
    return formatDelegationBatchLabel(counts);
  }, [subagentIds, subagents]);

  if (!label) return null;

  return (
    <p
      className="text-meta text-text-faint"
      data-delegation-batch-summary="true"
      data-live={live ? 'true' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      {label}
    </p>
  );
}
