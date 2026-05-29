/** Running conversation ids for dock chat search filter bypass. */
import { useChatStore } from '../../store/useChatStore.js';

export function collectRunningChatIds(): Set<string> {
  const set = new Set<string>();
  for (const [id, slice] of Object.entries(useChatStore.getState().slices)) {
    if (slice.isProcessing) set.add(id);
  }
  return set;
}
