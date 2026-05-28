/**
 * Shared attribution labels for pending-change rows.
 */

import type { CheckpointChangeKind, PendingChange } from '@shared/types/checkpoint.js';
import { chromeBadgeClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import { pendingKindDotClassName } from '../pending/pendingPanelStyles.js';

export function PendingChangeAttribution({ change }: { change: PendingChange }) {
  const hasToolAttribution = change.source === 'bash' || Boolean(change.subagentId);
  if (!hasToolAttribution) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
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
