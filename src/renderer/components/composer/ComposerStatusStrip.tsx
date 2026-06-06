/**
 * Composer hint strip — ask-user reply prompt and off-tail scroll hint.
 */

import { memo } from 'react';
import { useChatStore } from '../../store/useChatStore.js';
import { useTimelineUiStore } from '../../store/useTimelineUiStore.js';
import type { PendingAskUserEvent } from '../../lib/pendingAskUser.js';

interface ComposerStatusStripProps {
  pendingAskUser?: PendingAskUserEvent | null;
}

export const ComposerStatusStrip = memo(function ComposerStatusStrip({
  pendingAskUser = null
}: ComposerStatusStripProps) {
  const timelineAtTail = useTimelineUiStore((s) => s.timelineAtTail);
  const requestScrollToTail = useTimelineUiStore((s) => s.requestScrollToTail);
  const hasEvents = useChatStore((s) => s.events.length > 0);

  if (pendingAskUser) {
    const title =
      pendingAskUser.payload.title?.trim() ||
      'Answer in the panel above, or type here and press Send.';
    return (
      <span
        className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-text-secondary"
        role="status"
        aria-live="polite"
      >
        <span className="font-medium text-text-primary">Reply needed</span>
        {' — '}
        {title}
      </span>
    );
  }

  if (!timelineAtTail && hasEvents) {
    return (
      <span className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-text-faint">
        Scroll down or use{' '}
        <button
          type="button"
          className="vx-jump-to-latest-label cursor-pointer underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
          onClick={requestScrollToTail}
          aria-label="Jump to latest messages"
        >
          Latest
        </button>{' '}
        for new messages
      </span>
    );
  }

  return null;
});
