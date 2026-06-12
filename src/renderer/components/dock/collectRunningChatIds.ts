/** Running conversation ids for dock chat search filter bypass. */
import { isSliceRunActive, type RunActiveSlice } from '../../lib/isSliceRunActive.js';
import { useChatStore } from '../../store/useChatStore.js';

/**
 * Pure: derive the set of active conversation ids from a slices map.
 * Shared by the non-reactive `collectRunningChatIds()` and the reactive
 * `useShallow` selector in `DockChatStrip` so the membership rule lives
 * in exactly one place.
 */
export function runningChatIdsFromSlices(
  slices: Record<string, RunActiveSlice>
): Set<string> {
  const set = new Set<string>();
  for (const [id, slice] of Object.entries(slices)) {
    if (isSliceRunActive(slice)) set.add(id);
  }
  return set;
}

export function collectRunningChatIds(): Set<string> {
  return runningChatIdsFromSlices(useChatStore.getState().slices);
}
