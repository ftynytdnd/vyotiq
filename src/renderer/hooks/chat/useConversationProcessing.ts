/**
 * Per-conversation slice subscription.
 *
 * Returns the `{ isProcessing, runId }` for the slice keyed by `id`,
 * subscribing with a tuple-equality comparator so unrelated slice
 * mutations (events landing in OTHER conversations) never re-render
 * the consumer. This is the building block for any sidebar / composer
 * affordance that mirrors a conversation's run state without driving
 * the whole timeline through it.
 *
 * Returns `{ isProcessing: false, runId: null }` for an unknown id —
 * callers can render an "idle" branch unconditionally without a guard
 * on the id itself.
 */

import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../store/useChatStore.js';

interface ConversationProcessing {
  isProcessing: boolean;
  runId: string | null;
}

const IDLE: ConversationProcessing = { isProcessing: false, runId: null };

export function useConversationProcessing(id: string | null): ConversationProcessing {
  return useChatStore(
    useShallow((s) => {
      if (!id) return IDLE;
      const slice = s.slices[id];
      if (!slice) return IDLE;
      return { isProcessing: slice.isProcessing, runId: slice.runId };
    })
  );
}
