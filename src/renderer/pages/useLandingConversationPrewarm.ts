/**
 * Ensures a conversation exists on the empty-chat landing so attachments
 * work before the first send.
 */

import { useEffect, useRef } from 'react';
import { showDockChatsWhenExpanded } from '../components/dock/dockShared.js';
import { useChatStore } from '../store/useChatStore.js';
import { useConversationsStore } from '../store/useConversationsStore.js';

export interface LandingConversationPrewarmOptions {
  /** Empty-chat centered landing is active. */
  enabled: boolean;
  /** Workspace or provider not ready — skip prewarm. */
  needsSetup: boolean;
  /** Conversation list is loading a selection. */
  selecting: boolean;
  activeWorkspaceId: string | null;
  activeConversationId: string | null;
  chatConversationId: string | null;
}

export function useLandingConversationPrewarm({
  enabled,
  needsSetup,
  selecting,
  activeWorkspaceId,
  activeConversationId,
  chatConversationId
}: LandingConversationPrewarmOptions): void {
  const newConversation = useConversationsStore((s) => s.newConversation);
  const selectConversation = useConversationsStore((s) => s.select);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || needsSetup || selecting) return;
    if (!activeWorkspaceId) return;

    if (activeConversationId) {
      if (chatConversationId === activeConversationId) return;
      const convState = useConversationsStore.getState();
      if (
        convState.list.length > 0 &&
        !convState.list.some((m) => m.id === activeConversationId)
      ) {
        return;
      }
      if (convState.hydratedIds.has(activeConversationId)) {
        useChatStore.getState().setActiveConversation(activeConversationId);
        return;
      }
      void selectConversation(activeConversationId);
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void newConversation()
      .then((meta) => {
        if (meta) showDockChatsWhenExpanded();
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [
    enabled,
    needsSetup,
    selecting,
    activeWorkspaceId,
    activeConversationId,
    chatConversationId,
    newConversation,
    selectConversation
  ]);
}
