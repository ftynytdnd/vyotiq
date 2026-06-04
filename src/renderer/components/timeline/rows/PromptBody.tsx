/**
 * Collapsible prompt body — shared typography for user prompts and delegate tasks.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../../lib/cn.js';
import { timelineUserPromptBodyClassName } from '../shared/rowStyles.js';

const COLLAPSED_MAX_PX = 144;
const EXPANDED_MAX_PX = 320;

export interface PromptBodyProps {
  content: string;
  className?: string;
  /** Extra classes on the scrollable bubble (e.g. left border for workers). */
  bubbleClassName?: string;
}

export function PromptBody({ content, className, bubbleClassName }: PromptBodyProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;

    const measure = () => {
      const natural = el.scrollHeight;
      setOverflows(natural > COLLAPSED_MAX_PX + 4);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [content]);

  useEffect(() => {
    if (!overflows && expanded) setExpanded(false);
  }, [overflows, expanded]);

  const showToggle = overflows;
  const maxHeightPx = showToggle
    ? expanded
      ? EXPANDED_MAX_PX
      : COLLAPSED_MAX_PX
    : undefined;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="relative">
        <div
          ref={bubbleRef}
          className={cn(
            'vx-timeline-user-bubble pl-3',
            timelineUserPromptBodyClassName,
            bubbleClassName,
            showToggle && !expanded && 'overflow-hidden',
            showToggle && expanded && 'overflow-y-auto scrollbar-stealth max-h-80'
          )}
          style={maxHeightPx !== undefined ? { maxHeight: maxHeightPx } : undefined}
        >
          {content}
        </div>
        {showToggle && !expanded && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-base via-surface-base/60 to-transparent"
          />
        )}
      </div>
      {showToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start vx-btn vx-btn-quiet px-1.5 py-0.5 text-chat-meta"
          aria-expanded={expanded}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
