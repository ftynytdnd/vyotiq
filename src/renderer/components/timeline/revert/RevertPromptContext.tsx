/**
 * RevertPromptContext — a tiny react context that lets `UserPromptRow`
 * request the rewind-preview modal without having to thread the
 * modal's mount-state through every intermediate component.
 *
 * The provider is mounted around the `Timeline` subtree by
 * `ChatPage.tsx`; it also mounts the matching `RevertPreviewModal`
 * which renders via a portal so the dialog escapes any ancestor
 * `overflow-hidden` containment.
 *
 * Two intents are exposed:
 *
 *   - `requestRevert({ promptEventId })` — pure rewind; opens the
 *     preview modal and on confirm rewinds the conversation to
 *     just before that prompt.
 *
 *   - `requestEditAndResend({ promptEventId, content })` — opens the
 *     same preview modal in EDIT mode: the user can amend the
 *     original prompt's text, and on confirm the modal first
 *     rewinds (atomic file + transcript rollback to before the
 *     prompt) and THEN dispatches the edited text as a fresh turn
 *     through `useChatStore.send`. This restores the previously
 *     removed Edit & resend affordance with proper rewind
 *     semantics — the edited message lands at the SAME conversation
 *     position the original occupied, with no orphaned assistant
 *     output below.
 *
 * Consumers reach for the matching helper; the provider resolves
 * conversation / workspace context internally (via the chat +
 * workspace zustand stores) so the call site stays minimal.
 *
 * `useRevertPrompt()` deliberately returns `null` when no provider is
 * mounted (e.g. isolated `UserPromptRow` test fixtures). The Revert
 * affordance then renders disabled rather than crashing.
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
import { RevertPreviewModal } from './RevertPreviewModal.js';

/** Modal intent: pure rewind, or rewind + send an edited prompt. */
export type RevertIntent =
  | { kind: 'revert' }
  | { kind: 'edit'; originalContent: string };

interface RevertPromptValue {
  /** Open the revert-preview modal for the given prompt event. */
  requestRevert: (input: { promptEventId: string }) => void;
  /**
   * Open the modal in edit mode: the user reviews the rollback impact
   * AND amends the original prompt text. On confirm the modal first
   * rewinds, then dispatches the edited prompt as a fresh send.
   */
  requestEditAndResend: (input: {
    promptEventId: string;
    content: string;
  }) => void;
  /** Whether a modal is currently open. */
  isModalOpen: boolean;
}

const RevertPromptContext = createContext<RevertPromptValue | null>(null);

interface OpenState {
  conversationId: string;
  workspaceId: string;
  promptEventId: string;
  intent: RevertIntent;
}

export function RevertPromptProvider({
  model,
  children
}: {
  /**
   * Live composer model selection. Threaded down so the
   * `Edit & resend` flow can dispatch the amended prompt through
   * `chat.send` after the rewind settles. `null` is allowed (and
   * surfaced inline by the modal as "pick a model first").
   */
  model?: ModelSelection | null;
  children: ReactNode;
}) {
  const [openState, setOpenState] = useState<OpenState | null>(null);

  /**
   * Resolve the live conversation / workspace context. Returns `null`
   * when either is missing — the caller surfaces a toast in that case
   * rather than the silent no-op the previous implementation had,
   * which left the user wondering why their click was swallowed.
   */
  const resolveContext = useCallback(():
    | { conversationId: string; workspaceId: string }
    | null => {
    const conversationId = useChatStore.getState().conversationId;
    const workspaceId = useWorkspaceStore.getState().activeId;
    if (!conversationId || !workspaceId) return null;
    return { conversationId, workspaceId };
  }, []);

  const requestRevert = useCallback(
    (input: { promptEventId: string }) => {
      const ctx = resolveContext();
      if (!ctx) {
        useToastStore
          .getState()
          .show(
            'Revert is unavailable — pick a workspace and a conversation first.',
            'danger'
          );
        return;
      }
      setOpenState({
        conversationId: ctx.conversationId,
        workspaceId: ctx.workspaceId,
        promptEventId: input.promptEventId,
        intent: { kind: 'revert' }
      });
    },
    [resolveContext]
  );

  const requestEditAndResend = useCallback(
    (input: { promptEventId: string; content: string }) => {
      const ctx = resolveContext();
      if (!ctx) {
        useToastStore
          .getState()
          .show(
            'Edit & resend is unavailable — pick a workspace and a conversation first.',
            'danger'
          );
        return;
      }
      setOpenState({
        conversationId: ctx.conversationId,
        workspaceId: ctx.workspaceId,
        promptEventId: input.promptEventId,
        intent: { kind: 'edit', originalContent: input.content }
      });
    },
    [resolveContext]
  );

  const value = useMemo<RevertPromptValue>(
    () => ({
      requestRevert,
      requestEditAndResend,
      isModalOpen: openState !== null
    }),
    [requestRevert, requestEditAndResend, openState]
  );

  return (
    <RevertPromptContext.Provider value={value}>
      {children}
      <RevertPreviewModal
        open={openState !== null}
        conversationId={openState?.conversationId ?? null}
        workspaceId={openState?.workspaceId ?? null}
        promptEventId={openState?.promptEventId ?? null}
        intent={openState?.intent ?? { kind: 'revert' }}
        model={model ?? null}
        onClose={() => setOpenState(null)}
      />
    </RevertPromptContext.Provider>
  );
}

/**
 * Hook helper. Returns `null` when the consumer is rendered outside
 * the provider — call sites guard against this so an isolated test
 * mount of `UserPromptRow` doesn't crash.
 */
export function useRevertPrompt(): RevertPromptValue | null {
  return useContext(RevertPromptContext);
}
