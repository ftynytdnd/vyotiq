/**
 * Delegated worker — indented outline + mini thread of child rows.
 */

import type { ReactNode } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { cn } from '../../../lib/cn.js';
import type { DisplayRow } from '../shared/projectSubagentRows.js';
import {
  isWorkerFailedStatus,
  workerDisplayTag,
  workerStatusSuffix
} from './delegationHelpers.js';
import { DelegationWorkerOutline } from './DelegationWorkerOutline.js';
import { DelegationWorkerFailed } from './DelegationWorkerFailed.js';

interface DelegationWorkerProps {
  subagentId: string;
  rows: DisplayRow[];
  renderRow: (row: DisplayRow) => ReactNode;
  live?: boolean;
}

export function DelegationWorker({
  subagentId,
  rows,
  renderRow,
  live = false
}: DelegationWorkerProps) {
  const snap = useChatStore((s) => s.subagents[subagentId]);

  if (snap?.status === 'queued') {
    return null;
  }

  if (!snap) {
    return (
      <section
        className="vx-timeline-deleg-worker border-l-2 border-border-subtle/50 opacity-80"
        data-row-kind="delegation-worker"
        data-subagent-id={subagentId}
        data-worker-status="loading"
        aria-label={`Delegated worker ${subagentId.slice(0, 8)}`}
      >
        <div className="text-meta text-text-faint">Loading worker…</div>
        {rows.length > 0 ? (
          <div className="mt-1 flex flex-col gap-0.5 opacity-95">
            {rows
              .filter((r) => r.kind !== 'subagent-line')
              .map((row) => (
                <div key={row.key}>{renderRow(row)}</div>
              ))}
          </div>
        ) : null}
      </section>
    );
  }

  const failed = isWorkerFailedStatus(snap.status);
  const running = snap.status === 'pending' || snap.status === 'running';
  const inlineRows = rows.filter((r) => r.kind !== 'subagent-line');
  const workerLive = live && running;
  const statusSuffix = workerStatusSuffix(snap.status);
  const tag = workerDisplayTag(snap.id, snap);
  const ariaLabel = `${tag}${snap.task ? `: ${snap.task}` : ''}`;

  const thread = (
    <>
      {inlineRows.map((row) => (
        <div key={row.key} className={cn(workerLive && 'opacity-95')}>
          {renderRow(row)}
        </div>
      ))}
    </>
  );

  const canExpandFailed = failed && (snap.steps.length > 0 || inlineRows.length > 0);

  return (
    <section
      className="vx-timeline-deleg-worker border-l-2 border-border-subtle/50"
      data-row-kind="delegation-worker"
      data-subagent-id={subagentId}
      data-worker-status={statusSuffix ?? undefined}
      aria-label={ariaLabel}
    >
      <DelegationWorkerOutline snap={snap} />

      {failed ? (
        <DelegationWorkerFailed snap={snap} canExpand={canExpandFailed}>
          {thread}
        </DelegationWorkerFailed>
      ) : (
        <div className="mt-1 flex flex-col gap-0.5">{thread}</div>
      )}
    </section>
  );
}
