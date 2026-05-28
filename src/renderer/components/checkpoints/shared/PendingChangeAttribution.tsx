/**
 * Shared attribution + path labels for pending-change rows.
 */

import type { CheckpointChangeKind, PendingChange } from '@shared/types/checkpoint.js';
import { fileReviewDecision } from '@shared/checkpoints/reviewSessionBlocksSend.js';
import {
  reviewCacheKey,
  useCheckpointsStore
} from '../../../store/useCheckpointsStore.js';
import { chromeBadgeClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import {
  pendingKindDotClassName,
  pendingReviewDecisionBadgeClassName
} from '../pending/pendingPanelStyles.js';

export function PendingChangeAttribution({ change }: { change: PendingChange }) {
  const session = useCheckpointsStore(
    (s) =>
      (s.reviewByConversation ?? {})[reviewCacheKey(change.workspaceId, change.conversationId)] ??
      null
  );
  const decision = fileReviewDecision(session, change.filePath);
  const reviewer = session?.reviewerLabel?.trim();

  const hasToolAttribution = change.source === 'bash' || Boolean(change.subagentId);
  const hasReviewAttribution = Boolean(decision || reviewer);
  if (!hasToolAttribution && !hasReviewAttribution) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {reviewer && (
        <span
          className={cn(chromeBadgeClassName, 'max-w-20 truncate px-1 text-text-faint')}
          title={`Reviewer: ${reviewer}`}
        >
          {reviewer}
        </span>
      )}
      {decision === 'approve' && (
        <span
          className={cn(pendingReviewDecisionBadgeClassName('approve'), 'px-1 uppercase')}
          title="Approved in review"
        >
          approved
        </span>
      )}
      {decision === 'request_changes' && (
        <span
          className={cn(pendingReviewDecisionBadgeClassName('request_changes'), 'px-1 uppercase')}
          title="Request changes in review"
        >
          changes
        </span>
      )}
      {change.source === 'bash' && (
        <span
          className={cn(chromeBadgeClassName, 'px-1 font-mono uppercase')}
          title="Recovered from a bash command"
        >
          bash
        </span>
      )}
      {change.subagentId && (
        <span
          className={cn(
            chromeBadgeClassName,
            'max-w-16 truncate px-1 font-mono text-text-faint'
          )}
          title={`Sub-agent ${change.subagentId}`}
        >
          {change.subagentId}
        </span>
      )}
    </span>
  );
}

function PendingChangeKindDot({ kind }: { kind: CheckpointChangeKind }) {
  return (
    <span
      className={pendingKindDotClassName(kind)}
      aria-hidden
      title={kind === 'create' ? 'Created' : kind === 'delete' ? 'Deleted' : 'Modified'}
    />
  );
}

export function PendingChangePathLabel({
  change,
  stackCount,
  compact = false
}: {
  change: PendingChange;
  stackCount?: number;
  compact?: boolean;
}) {
  const pathIndex = Math.max(change.filePath.lastIndexOf('/'), change.filePath.lastIndexOf('\\'));
  const fileName = pathIndex >= 0 ? change.filePath.slice(pathIndex + 1) : change.filePath;
  const dirName = pathIndex >= 0 ? change.filePath.slice(0, pathIndex + 1) : '';

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-1.5 truncate',
        compact ? 'text-meta' : 'text-row'
      )}
      title={change.filePath}
    >
      <PendingChangeKindDot kind={change.kind} />
      {compact ? (
        <span className="truncate font-mono text-text-secondary">{fileName}</span>
      ) : (
        <span className="truncate font-mono text-text-secondary">
          {dirName && <span className="text-text-faint">{dirName}</span>}
          {fileName}
        </span>
      )}
      {stackCount !== undefined && stackCount > 1 && (
        <span className="shrink-0 font-mono text-meta text-text-faint">×{stackCount}</span>
      )}
    </div>
  );
}
