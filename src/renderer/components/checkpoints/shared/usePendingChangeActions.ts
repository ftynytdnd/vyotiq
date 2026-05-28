/**
 * Shared accept / reject / open handlers for pending-change surfaces.
 * Centralises toast copy so panel rows, inline timeline actions, and
 * stacked file groups stay consistent.
 */

import type { PendingChange } from '@shared/types/checkpoint.js';
import { useCheckpointsStore } from '../../../store/useCheckpointsStore.js';
import { useToastStore } from '../../../store/useToastStore.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { openWorkspaceFile } from '../../../lib/openPath.js';

function rejectErrorMessage(change: PendingChange, kind: string, message?: string): string {
  if (kind === 'blob-missing') {
    return `Snapshot missing — cannot revert ${change.filePath}.`;
  }
  if (kind === 'fs') {
    return `Revert failed: ${message ?? 'unknown error'}`;
  }
  if (kind === 'sandbox') {
    return `Revert blocked by sandbox: ${message ?? 'unknown error'}`;
  }
  return `Revert failed (${kind}).`;
}

export function usePendingChangeActions(change: PendingChange) {
  const accept = useCheckpointsStore((s) => s.accept);
  const reject = useCheckpointsStore((s) => s.reject);
  const showToast = useToastStore((s) => s.show);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeId);

  const canOpenInEditor = change.kind !== 'delete';

  const onAccept = () => {
    void accept(change.entryId, change.conversationId).then((ok) => {
      if (!ok) {
        showToast(`Could not accept change for ${change.filePath}`, 'danger');
      }
    });
  };

  const onReject = async () => {
    const result = await reject(change.entryId, change.conversationId);
    if (!result.ok) {
      showToast(
        rejectErrorMessage(change, result.error.kind, 'message' in result.error ? result.error.message : undefined),
        'danger'
      );
    } else {
      showToast(`Reverted ${change.filePath}`, 'success');
    }
  };

  const onOpenFile = () => {
    if (!canOpenInEditor) return;
    void openWorkspaceFile(change.filePath, {
      ...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {}),
      context: 'pending-change'
    });
  };

  return { onAccept, onReject, onOpenFile, canOpenInEditor };
}

export function usePendingChangeBulkActions(entries: readonly PendingChange[]) {
  const accept = useCheckpointsStore((s) => s.accept);
  const reject = useCheckpointsStore((s) => s.reject);
  const showToast = useToastStore((s) => s.show);
  const head = entries[entries.length - 1];

  const onAcceptAll = async () => {
    if (!head) return;
    let failed = 0;
    for (const entry of entries) {
      const ok = await accept(entry.entryId, entry.conversationId);
      if (!ok) failed += 1;
    }
    if (failed > 0) {
      showToast(
        `Could not accept ${failed} change${failed === 1 ? '' : 's'} for ${head.filePath}`,
        'danger'
      );
    }
  };

  const onRejectAll = async () => {
    if (!head) return;
    const ordered = [...entries].sort((a, b) => b.createdAt - a.createdAt);
    let failed = 0;
    for (const entry of ordered) {
      const result = await reject(entry.entryId, entry.conversationId);
      if (!result.ok) failed += 1;
    }
    if (failed > 0) {
      showToast(
        `Could not revert ${failed} change${failed === 1 ? '' : 's'} for ${head.filePath}`,
        'danger'
      );
    } else {
      showToast(`Reverted ${head.filePath}`, 'success');
    }
  };

  return { onAcceptAll, onRejectAll, head };
}
