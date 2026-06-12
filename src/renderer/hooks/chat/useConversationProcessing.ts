/**
 * Per-conversation slice subscription.
 *
 * Returns the `{ isProcessing, runId }` for the slice keyed by `id`,
 * subscribing with a tuple-equality comparator so unrelated slice
 * mutations (events landing in OTHER conversations) never re-render
 * the consumer. Building block for dock tabs and composer affordances
 * that mirror a conversation's run state without driving the whole
 * timeline through them.
 *
 * Returns `{ isProcessing: false, runId: null }` for an unknown id —
 * callers can render an "idle" branch unconditionally without a guard
 * on the id itself.
 */

import { useShallow } from 'zustand/react/shallow';
import { isSliceRunActive } from '../../lib/isSliceRunActive.js';
import { useChatStore } from '../../store/useChatStore.js';

interface ConversationProcessing {
  isProcessing: boolean;
  awaitingAskUser: boolean;
  isRunActive: boolean;
  runId: string | null;
}

const IDLE: ConversationProcessing = {
  isProcessing: false,
  awaitingAskUser: false,
  isRunActive: false,
  runId: null
};

export function useConversationProcessing(id: string | null): ConversationProcessing {
  return useChatStore(
    useShallow((s) => {
      if (!id) return IDLE;
      const slice = s.slices[id];
      if (!slice) return IDLE;
      return {
        isProcessing: slice.isProcessing,
        awaitingAskUser: slice.awaitingAskUser,
        isRunActive: isSliceRunActive(slice),
        runId: slice.runId
      };
    })
  );
}
