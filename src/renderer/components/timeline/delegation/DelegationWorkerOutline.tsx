/**
 * Worker outline row — model id tag, task body, and live tool-verb status.
 */

import { cn } from '../../../lib/cn.js';
import { resolveSubAgentSubtitle } from './subtitleResolver.js';
import type { SubAgentSnapshot } from '../reducer/types.js';
import { PromptBody } from '../rows/PromptBody.js';
import {
  workerDisplayTag,
  workerStatusSuffix,
  isWorkerFailedStatus,
  isWorkerPartialStatus
} from './delegationHelpers.js';

interface DelegationWorkerOutlineProps {
  snap: SubAgentSnapshot;
}

export function DelegationWorkerOutline({ snap }: DelegationWorkerOutlineProps) {
  const failed = isWorkerFailedStatus(snap.status);
  const partial = isWorkerPartialStatus(snap.status);
  const live = snap.status === 'pending' || snap.status === 'running';
  const activityLine = live ? resolveSubAgentSubtitle(snap) : null;
  const suffix = activityLine ? null : workerStatusSuffix(snap.status);
  const tag = workerDisplayTag(snap.id, snap);

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-row">
        <span
          className={cn(
            'shrink-0 font-mono text-meta font-medium',
            failed ? 'text-danger' : 'text-text-secondary'
          )}
        >
          {tag}
        </span>
        {activityLine ? (
          <span className="min-w-0 flex-1 truncate text-meta text-text-faint" title={activityLine}>
            {activityLine}
          </span>
        ) : suffix ? (
          <span
            className={cn(
              'shrink-0 text-meta',
              failed ? 'text-danger' : partial ? 'text-warning' : 'text-text-faint'
            )}
          >
            {suffix}
          </span>
        ) : null}
      </div>
      {snap.task.trim().length > 0 ? (
        <PromptBody
          content={snap.task}
          variant="single-line"
          bubbleClassName="border-l border-border-subtle/50"
        />
      ) : null}
    </div>
  );
}
