/**
 * Compact Accept / Reject controls for pending-change surfaces.
 * Timeline edit rows mount these always-visible; the pending panel
 * can opt into hover-gating so the list stays visually quiet.
 */

import type { PendingChange } from '@shared/types/checkpoint.js';
import { Button } from '../../ui/Button.js';
import { cn } from '../../../lib/cn.js';
import {
  usePendingChangeActions,
  usePendingChangeBulkActions
} from './usePendingChangeActions.js';

interface InlinePendingActionsProps {
  change?: PendingChange;
  /** When set, Accept/Reject operate on every entry (newest-first reject). */
  changes?: readonly PendingChange[];
  className?: string;
  /** Panel rows hide actions until hover/focus; timeline rows stay visible. */
  hoverGated?: boolean;
  /** Keep action buttons visible (review mode). */
  alwaysVisible?: boolean;
  /** Optional open-in-editor affordance for panel file rows. */
  showOpen?: boolean;
  /** Tighter action buttons for panel rows. */
  compact?: boolean;
}

export function InlinePendingActions(props: InlinePendingActionsProps) {
  if (props.changes && props.changes.length > 1) {
    return <BulkPendingActions {...props} changes={props.changes} />;
  }
  if (props.change) {
    return <SinglePendingActions {...props} change={props.change} />;
  }
  return null;
}

function SinglePendingActions({
  change,
  className,
  hoverGated = false,
  alwaysVisible = false,
  showOpen = false,
  compact = false
}: InlinePendingActionsProps & { change: PendingChange }) {
  const { onAccept, onReject, onOpenFile, canOpenInEditor } = usePendingChangeActions(change);

  return (
    <ActionButtons
      className={className}
      hoverGated={hoverGated && !alwaysVisible}
      compact={compact}
      filePath={change.filePath}
      onAccept={onAccept}
      onReject={onReject}
      {...(showOpen && canOpenInEditor
        ? { onOpenFile, showOpen: true as const }
        : { showOpen: false as const })}
    />
  );
}

function BulkPendingActions({
  changes,
  className,
  hoverGated = false,
  alwaysVisible = false,
  showOpen = false,
  compact = false
}: InlinePendingActionsProps & { changes: readonly PendingChange[] }) {
  const { onAcceptAll, onRejectAll, head } = usePendingChangeBulkActions(changes);
  const anchor = head ?? changes[changes.length - 1]!;
  const { onOpenFile, canOpenInEditor } = usePendingChangeActions(anchor);
  if (!head) return null;

  return (
    <ActionButtons
      className={className}
      hoverGated={hoverGated && !alwaysVisible}
      compact={compact}
      filePath={head.filePath}
      onAccept={() => void onAcceptAll()}
      onReject={() => void onRejectAll()}
      {...(showOpen && canOpenInEditor
        ? { onOpenFile, showOpen: true as const }
        : { showOpen: false as const })}
      bulk
    />
  );
}

function ActionButtons({
  className,
  hoverGated,
  compact = false,
  filePath,
  onAccept,
  onReject,
  onOpenFile,
  showOpen,
  bulk = false
}: {
  className?: string;
  hoverGated?: boolean;
  compact?: boolean;
  filePath: string;
  onAccept: () => void;
  onReject: () => void;
  onOpenFile?: () => void;
  showOpen?: boolean;
  bulk?: boolean;
}) {
  const acceptLabel = bulk ? `Accept all changes for ${filePath}` : `Accept ${filePath}`;
  const rejectLabel = bulk ? `Reject all changes for ${filePath}` : `Reject ${filePath}`;

  return (
    <div
      className={cn(
        'flex shrink-0 items-center',
        compact ? 'gap-0.5' : 'gap-1',
        hoverGated &&
          'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100',
        className
      )}
    >
      {showOpen && onOpenFile && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onOpenFile}
          aria-label={`Open ${filePath} in editor`}
          title="Open in editor"
          className={cn(compact && 'h-6 px-1.5 text-meta text-text-muted')}
        >
          Open
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onReject}
        aria-label={rejectLabel}
        className={cn(compact && 'h-6 px-1.5 text-meta')}
      >
        Reject
      </Button>
      <Button
        size="sm"
        variant={compact ? 'primary' : 'secondary'}
        onClick={onAccept}
        aria-label={acceptLabel}
        className={cn(compact && 'h-6 px-2 text-meta')}
      >
        Accept
      </Button>
    </div>
  );
}
