/**
 * Workspace remove / retry — full-width dock banner (horizontal layout).
 */

import { useEffect, useRef } from 'react';
import type { WorkspaceEntry } from '@shared/types/ipc.js';
import { Button } from '../ui/Button.js';

export type WorkspacePendingAction =
  | { kind: 'remove-confirm'; workspace: WorkspaceEntry }
  | { kind: 'remove-choice'; workspace: WorkspaceEntry }
  | { kind: 'retry'; workspace: WorkspaceEntry };

export interface WorkspacePendingBannerProps {
  pending: WorkspacePendingAction;
  onDismiss: () => void;
  onRemoveContinue: (workspaceId: string) => void;
  onRemoveKeepChats: (workspaceId: string) => void;
  onRemoveDeleteChats: (workspaceId: string) => void;
  onRetry: (workspaceId: string) => void;
}

export function WorkspacePendingBanner({
  pending,
  onDismiss,
  onRemoveContinue,
  onRemoveKeepChats,
  onRemoveDeleteChats,
  onRetry
}: WorkspacePendingBannerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { workspace } = pending;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && root.contains(target)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={
        pending.kind === 'remove-confirm'
          ? `Remove workspace ${workspace.label}`
          : pending.kind === 'remove-choice'
            ? `Choose how to remove ${workspace.label}`
            : `Retry path for ${workspace.label}`
      }
      data-inline-confirm="true"
      className="vx-dock-workspace-pending mt-1.5 flex min-w-0 flex-col gap-1.5 rounded-inner border border-border-subtle/40 bg-surface-overlay/60 px-2 py-1.5"
    >
      {pending.kind === 'remove-confirm' ? (
        <>
          <p className="min-w-0 text-row text-text-secondary">
            Remove workspace{' '}
            <span className="font-medium text-text-primary">{workspace.label}</span>?
          </p>
          <div className="flex flex-wrap justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={() => onRemoveContinue(workspace.id)}>
              Continue
            </Button>
          </div>
        </>
      ) : pending.kind === 'remove-choice' ? (
        <>
          <p className="min-w-0 text-row text-text-secondary">
            Delete chats in{' '}
            <span className="font-medium text-text-primary">{workspace.label}</span> too?
          </p>
          <div className="flex flex-wrap justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Cancel
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onRemoveKeepChats(workspace.id)}>
              Keep chats
            </Button>
            <Button size="sm" variant="danger" onClick={() => onRemoveDeleteChats(workspace.id)}>
              Delete chats
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="min-w-0 text-row text-text-secondary">
            Retry path for{' '}
            <span className="font-medium text-text-primary">{workspace.label}</span>?
          </p>
          <div className="flex flex-wrap justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={() => onRetry(workspace.id)}>
              Retry
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
