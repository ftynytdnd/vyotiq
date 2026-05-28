/**
 * Review drawer — SecondaryZone host for pending + PR review body.
 */

import { useEffect } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import {
  useCheckpointsStore,
  usePendingChanges
} from '../../../store/useCheckpointsStore.js';
import { useSecondaryZoneStore } from '../../../store/useSecondaryZoneStore.js';
import { PendingChangesReviewBody } from '../pending/PendingChangesReviewBody.js';
import { chromeInsetNoteClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';

export function ReviewDrawerPanel() {
  const close = useSecondaryZoneStore((s) => s.close);
  const reviewOpts = useSecondaryZoneStore((s) => s.reviewOpts);
  const activeConversationId = useChatStore((s) => s.conversationId);
  const conversationId = reviewOpts?.conversationId ?? activeConversationId;
  const pending = usePendingChanges(conversationId);
  const refreshPending = useCheckpointsStore((s) => s.refreshPending);

  useEffect(() => {
    if (!conversationId) return;
    void refreshPending(conversationId);
  }, [conversationId, refreshPending]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      {!conversationId ? (
        <div className={cn(chromeInsetNoteClassName, 'text-text-muted')}>
          Select a conversation to review pending changes.
        </div>
      ) : (
        <PendingChangesReviewBody
          entries={pending}
          initialFilePath={reviewOpts?.filePath ?? null}
          onFinished={close}
        />
      )}
    </div>
  );
}
