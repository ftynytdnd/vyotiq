/**
 * Lets `UserPromptRow` open inline edit / revert at the prompt (no modal).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useWorkspaceStore } from '../../../store/useWorkspaceStore.js';
import { useToastStore } from '../../../store/useToastStore.js';

export type RevertIntent =
  | { kind: 'revert' }
  | { kind: 'edit'; originalContent: string };

export interface PromptSessionState {
  conversationId: string;
  workspaceId: string;
  promptEventId: string;
  intent: RevertIntent;
}

interface RevertPromptValue {
  requestRevert: (input: { promptEventId: string }) => void;
  requestEditAndResend: (input: {
    promptEventId: string;
    content: string;
  }) => void;
  activeSession: PromptSessionState | null;
  closeSession: () => void;
  isSessionOpen: boolean;
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
}

const RevertPromptContext = createContext<RevertPromptValue | null>(null);

export function RevertPromptProvider({
  model,
  onModelChange,
  onOpenProviders,
  children
}: {
  model?: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
  children: ReactNode;
}) {
  const [activeSession, setActiveSession] = useState<PromptSessionState | null>(null);

  const resolveContext = useCallback(():
    | { conversationId: string; workspaceId: string }
    | null => {
    const conversationId = useChatStore.getState().conversationId;
    const workspaceId = useWorkspaceStore.getState().activeId;
    if (!conversationId || !workspaceId) return null;
    return { conversationId, workspaceId };
  }, []);

  const openSession = useCallback(
    (promptEventId: string, intent: RevertIntent) => {
      const ctx = resolveContext();
      if (!ctx) {
        useToastStore
          .getState()
          .show(
            intent.kind === 'edit'
              ? 'Edit & resend is unavailable — pick a workspace and a conversation first.'
              : 'Revert is unavailable — pick a workspace and a conversation first.',
            'danger'
          );
        return;
      }
      setActiveSession({
        conversationId: ctx.conversationId,
        workspaceId: ctx.workspaceId,
        promptEventId,
        intent
      });
    },
    [resolveContext]
  );

  const requestRevert = useCallback(
    (input: { promptEventId: string }) => {
      openSession(input.promptEventId, { kind: 'revert' });
    },
    [openSession]
  );

  const requestEditAndResend = useCallback(
    (input: { promptEventId: string; content: string }) => {
      openSession(input.promptEventId, {
        kind: 'edit',
        originalContent: input.content
      });
    },
    [openSession]
  );

  const closeSession = useCallback(() => setActiveSession(null), []);

  const value = useMemo<RevertPromptValue>(
    () => ({
      requestRevert,
      requestEditAndResend,
      activeSession,
      closeSession,
      isSessionOpen: activeSession !== null,
      model: model ?? null,
      onModelChange,
      onOpenProviders
    }),
    [
      requestRevert,
      requestEditAndResend,
      activeSession,
      closeSession,
      model,
      onModelChange,
      onOpenProviders
    ]
  );

  return (
    <RevertPromptContext.Provider value={value}>{children}</RevertPromptContext.Provider>
  );
}

export function useRevertPrompt(): RevertPromptValue | null {
  return useContext(RevertPromptContext);
}
