/**
 * Returns `true` when at least one conversation in the given workspace
 * has an in-flight run (`slices[convId].isProcessing === true`).
 *
 * Folds `useChatStore.slices` against the `useConversationsStore.list`
 * (filtered by `workspaceId`). Both reads use a shallow comparator so
 * an event landing on an unrelated workspace's slice never re-renders
 * consumers of this hook.
 *
 * Used by the bottom dock chat strip to keep running tabs visible when
 * search filter would otherwise hide it (so a streaming run is never
 * hidden by an unrelated query), and is reusable for any future
 * per-workspace badge / state surface.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../store/useChatStore.js';
import { useConversationsStore } from '../../store/useConversationsStore.js';

export function useWorkspaceHasActiveRun(workspaceId: string | null): boolean {
  const conversationIds = useConversationsStore(
    useShallow((s) =>
      workspaceId
        ? s.list.filter((m) => m.workspaceId === workspaceId).map((m) => m.id)
        : []
    )
  );
  // Memoise the id-set so the chat-store selector below only re-evaluates
  // when the workspace's conversation membership actually changes
  // (e.g. a new conversation was created or removed in this workspace),
  // not on every meta `updatedAt` bump from streaming events.
  const idSet = useMemo(() => new Set(conversationIds), [conversationIds]);
  return useChatStore(
    useShallow((s) => {
      if (idSet.size === 0) return false;
      for (const id of idSet) {
        if (s.slices[id]?.isProcessing) return true;
      }
      return false;
    })
  );
}
