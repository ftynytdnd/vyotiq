/**
 * Empty-workspace landing: create one conversation so attachments work
 * before first send. Session restore (persisted slot / newest chat) is
 * owned by `useConversationsStore.restoreWorkspaceSession` in App.tsx.
 */

import { useEffect } from 'react';
import { showDockChatsWhenExpanded } from '../components/dock/dockShared.js';
import { isSessionBootReady, useConversationsStore } from '../store/useConversationsStore.js';

export interface LandingConversationPrewarmOptions {
  /** Empty-chat centered landing is active. */
  enabled: boolean;
  /** Workspace or provider not ready — skip prewarm. */
  needsSetup: boolean;
  /** Conversation list is loading a selection. */
  selecting: boolean;
  activeWorkspaceId: string | null;
}

export function useLandingConversationPrewarm({
  enabled,
  needsSetup,
  selecting,
  activeWorkspaceId
}: LandingConversationPrewarmOptions): void {
  const ensureLandingConversation = useConversationsStore((s) => s.ensureLandingConversation);
  const sessionBootReady = useConversationsStore((s) => isSessionBootReady(s));

  useEffect(() => {
    if (!enabled || needsSetup || selecting || !sessionBootReady || !activeWorkspaceId) return;
    void ensureLandingConversation(activeWorkspaceId).then((meta) => {
      if (meta) showDockChatsWhenExpanded();
    });
  }, [
    enabled,
    needsSetup,
    selecting,
    sessionBootReady,
    activeWorkspaceId,
    ensureLandingConversation
  ]);
}
