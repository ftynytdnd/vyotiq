/**
 * Failed sub-agent chrome — one-line error, optional expanded trace.
 * Mirrors orchestrator failed-tool pattern (collapsed until Show details).
 */

import { useState, type ReactNode } from 'react';
import type { SubAgentSnapshot } from '../reducer/types.js';
import { cn } from '../../../lib/cn.js';

export function workerFailureLine(snap: SubAgentSnapshot): string {
  if (typeof snap.message === 'string' && snap.message.trim().length > 0) {
    return snap.message.trim().split('\n')[0]!;
  }
  if (typeof snap.output === 'string' && snap.output.trim().length > 0) {
    return snap.output.trim().split('\n')[0]!;
  }
  if (snap.status === 'aborted') return 'Stopped';
  return 'Worker failed';
}

interface DelegationWorkerFailedProps {
  snap: SubAgentSnapshot;
  canExpand: boolean;
  children: ReactNode;
}

export function DelegationWorkerFailed({
  snap,
  canExpand,
  children
}: DelegationWorkerFailedProps) {
  const [expanded, setExpanded] = useState(false);
  const line = workerFailureLine(snap);

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-meta">
        <span className="min-w-0 truncate text-danger" title={line}>
          {line}
        </span>
        {canExpand ? (
          <button
            type="button"
            className="shrink-0 text-text-faint underline-offset-2 hover:text-text-secondary hover:underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide details' : 'Show details'}
          </button>
        ) : null}
      </div>
      {(!canExpand || expanded) && (
        <div className={cn('mt-1 flex flex-col gap-0.5', canExpand && 'pt-0.5')}>{children}</div>
      )}
    </>
  );
}
