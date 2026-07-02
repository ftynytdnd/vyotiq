/**
 * Scroll timeline to a prompt row after Mod+K message search navigation.
 */

import { useEffect } from 'react';
import { useDockSearchStore } from '../store/useDockSearchStore.js';
import { useChatStore } from '../store/useChatStore.js';
import { scrollToRowAnchor } from '../components/timeline/shared/timelineRowAnchor.js';

export function usePendingTimelineScroll(): void {
  const conversationId = useChatStore((s) => s.conversationId);
  const eventsLength = useChatStore((s) => s.events.length);
  const pending = useDockSearchStore((s) => s.pendingTimelineScroll);

  useEffect(() => {
    if (!pending) return;
    if (pending.conversationId !== conversationId) return;
    if (eventsLength === 0) return;

    const scroll = () => {
      if (scrollToRowAnchor(pending.eventId)) {
        useDockSearchStore.getState().setPendingTimelineScroll(null);
        return true;
      }
      return false;
    };

    if (scroll()) return;
    const timer = window.setTimeout(scroll, 150);
    return () => window.clearTimeout(timer);
  }, [conversationId, eventsLength, pending]);
}
