/**
 * ReasoningLineRow — muted single-line reasoning; collapsed by default when done.
 */

import { useEffect, useRef } from 'react';
import { useChatStore } from '../../../store/useChatStore.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { useScrollTailStick } from '../shared/useScrollTailStick.js';
import { cn } from '../../../lib/cn.js';
import { reasoningHeadlineClassName } from '../shared/rowStyles.js';
import { formatReasoningLabel } from '../../../lib/reasoningLabel.js';

const REASONING_BODY_MAX_H = 'max-h-48';
const PROSE_COLLAPSE_DELAY_MS = 1000;

function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    document.documentElement.dataset.reducedMotion === 'true' ||
    (typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches)
  );
}

interface ReasoningLineRowProps {
  id: string;
}

export function ReasoningLineRow({ id }: ReasoningLineRowProps) {
  const acc = useChatStore((s) => s.reasoningTexts[id]);
  const rowKey = `reasoning:${id}`;
  const accDone = acc?.done ?? true;
  const hasOrchestratorProse = useChatStore((s) => {
    for (const t of Object.values(s.assistantTexts)) {
      if (!t.done && t.text.trim().length > 0) return true;
    }
    return false;
  });
  const fadeReasoning = accDone && hasOrchestratorProse;
  const { expanded, onToggle, setExpanded, userOverridden } = useTimelineRowExpand({
    rowKey,
    defaultExpanded: false,
    liveAutoExpand: !accDone && !hasOrchestratorProse
  });

  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proseSeenRef = useRef(false);

  useEffect(() => {
    if (!hasOrchestratorProse) {
      proseSeenRef.current = false;
      return;
    }
    if (proseSeenRef.current || userOverridden || !expanded) return;
    proseSeenRef.current = true;
    const delay = prefersReducedMotion() ? 0 : PROSE_COLLAPSE_DELAY_MS;
    collapseTimerRef.current = setTimeout(() => {
      collapseTimerRef.current = null;
      setExpanded(false);
    }, delay);
    return () => {
      if (collapseTimerRef.current !== null) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
    };
  }, [hasOrchestratorProse, userOverridden, expanded, setExpanded]);

  const hasText = !!acc && acc.text.trim().length > 0;
  const accText = acc?.text ?? '';
  const { bodyRef, onBodyScroll } = useScrollTailStick(accText, {
    active: !accDone,
    expanded
  });

  if (!acc || !hasText) return null;

  const { text: label, streaming } = formatReasoningLabel({
    startedAt: acc.startedAt,
    ...(acc.endedAt !== undefined ? { endedAt: acc.endedAt } : {}),
    done: acc.done,
    ...(acc.effort !== undefined ? { effort: acc.effort } : {})
  });

  const headline = (
    <span className={reasoningHeadlineClassName(streaming)}>{label}</span>
  );

  return (
    <div
      className={cn(
        'vyotiq-stepfade-once flex flex-col transition-opacity duration-300',
        fadeReasoning && !expanded && 'opacity-40'
      )}
      data-row-kind="reasoning-line"
    >
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
        expandAriaLabel={expanded ? 'Collapse reasoning' : 'Expand reasoning'}
        panelId={`timeline-panel-${rowKey}`}
      >
        {headline}
      </TimelineRowHeader>

      {expanded && (
        <DetailShell variant="flat">
          <div
            id={`timeline-panel-${rowKey}`}
            ref={bodyRef}
            onScroll={onBodyScroll}
            className={cn(
              'overflow-y-auto whitespace-pre-wrap pr-1 vx-caption italic leading-relaxed',
              REASONING_BODY_MAX_H
            )}
          >
            {acc.text}
          </div>
        </DetailShell>
      )}
    </div>
  );
}
