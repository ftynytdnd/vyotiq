/**
 * Counts processing slices that are NOT the active conversation, plus
 * the first such id (so a "Show" affordance can scroll the right
 * dock chat tab into view.
 *
 * The active slice is excluded because the composer's own Stop button
 * already covers it — surfacing it again as "running elsewhere" would
 * be redundant noise.
 *
 * Subscribed with `useShallow` so consumer components only re-render
 * when the count or the first id changes — not on every streaming
 * event landing in those slices.
 */

import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../store/useChatStore.js';

interface BackgroundRunsSnapshot {
  count: number;
  firstRunningId: string | null;
}

const EMPTY: BackgroundRunsSnapshot = { count: 0, firstRunningId: null };

export function useBackgroundRuns(): BackgroundRunsSnapshot {
  return useChatStore(
    useShallow((s) => {
      const activeId = s.conversationId;
      let count = 0;
      let firstRunningId: string | null = null;
      for (const [id, slice] of Object.entries(s.slices)) {
        if (id === activeId) continue;
        if (!slice.isProcessing) continue;
        count += 1;
        if (firstRunningId === null) firstRunningId = id;
      }
      if (count === 0) return EMPTY;
      return { count, firstRunningId };
    })
  );
}
