/**
 * Timeline header — load older transcript events when the slice is partial.
 */

import { useCallback, useState, type RefObject } from 'react';
import { ChevronUp } from 'lucide-react';
import type { TranscriptPaging } from '@shared/types/chat.js';
import { vyotiq } from '../../lib/ipc.js';
import { useChatStore } from '../../store/useChatStore.js';
import { findTimelineScrollParent } from './shared/timelineScrollParent.js';
import { Button } from '../ui/Button.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

interface TranscriptLoadEarlierProps {
  containerRef: RefObject<HTMLElement | null>;
  paging: TranscriptPaging;
}

export function TranscriptLoadEarlier({ containerRef, paging }: TranscriptLoadEarlierProps) {
  const conversationId = useChatStore((s) => s.conversationId);
  const loadedCount = useChatStore((s) => s.events.length);
  const [busy, setBusy] = useState(false);

  const onLoadEarlier = useCallback(async () => {
    if (!conversationId || busy || !paging.hasOlder) return;
    const events = useChatStore.getState().events;
    const firstId = events[0]?.id;
    if (!firstId) return;

    const scrollParent = findTimelineScrollParent(containerRef.current);
    const prevHeight = scrollParent?.scrollHeight ?? 0;

    setBusy(true);
    try {
      const page = await vyotiq.conversations.readBefore(conversationId, firstId);
      const nextPaging: TranscriptPaging = {
        totalCount: paging.totalCount,
        hasOlder: page.hasOlder,
        partial: page.hasOlder
      };
      useChatStore.getState().prependTranscript(conversationId, page.events, nextPaging);
      requestAnimationFrame(() => {
        if (!scrollParent) return;
        scrollParent.scrollTop += scrollParent.scrollHeight - prevHeight;
      });
    } finally {
      setBusy(false);
    }
  }, [busy, containerRef, conversationId, paging.hasOlder, paging.totalCount]);

  if (!paging.hasOlder) return null;

  const hiddenCount = Math.max(0, paging.totalCount - loadedCount);

  return (
    <div className="flex justify-center py-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void onLoadEarlier()}
        aria-label="Load earlier messages"
      >
        <ChevronUp className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
        {busy
          ? 'Loading…'
          : hiddenCount > 0
            ? `Load earlier (${hiddenCount} more)`
            : 'Load earlier'}
      </Button>
    </div>
  );
}
