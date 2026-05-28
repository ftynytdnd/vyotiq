/**
 * ReasoningLineRow — muted single-line reasoning; collapsed by default when done.
 */

import { useChatStore } from '../../../store/useChatStore.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { useScrollTailStick } from '../shared/useScrollTailStick.js';
import { cn } from '../../../lib/cn.js';
import { reasoningHeadlineClassName } from '../shared/rowStyles.js';
import { formatReasoningLabel } from '../../../lib/reasoningLabel.js';

const REASONING_BODY_MAX_H = 'max-h-48';

interface ReasoningLineRowProps {
  id: string;
}

export function ReasoningLineRow({ id }: ReasoningLineRowProps) {
  const acc = useChatStore((s) => s.reasoningTexts[id]);
  const rowKey = `reasoning:${id}`;
  const accDone = acc?.done ?? true;
  const { expanded, onToggle } = useTimelineRowExpand({
    rowKey,
    defaultExpanded: false,
    liveAutoExpand: !accDone
  });

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
    done: acc.done
  });

  const headline = (
    <span className={reasoningHeadlineClassName(streaming, 'orchestrator')}>{label}</span>
  );

  return (
    <div className="vyotiq-stepfade-once flex flex-col" data-row-kind="reasoning-line">
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
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
              'overflow-y-auto whitespace-pre-wrap pr-1 text-meta italic leading-relaxed text-text-faint',
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
