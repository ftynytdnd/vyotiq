/**
 * Inline assistant prose for Stream weave worker lines.
 */

import { useChatStore } from '../../../store/useChatStore.js';
import { displayAssistantTurnText } from '../../../lib/text.js';
import { StreamingMarkdownBody } from '../markdown/StreamingMarkdownBody.js';
import { cn } from '../../../lib/cn.js';

interface DelegationInlineProseProps {
  id: string;
  subagentId: string;
  live?: boolean;
}

export function DelegationInlineProse({ id, subagentId, live = false }: DelegationInlineProseProps) {
  const acc = useChatStore((s) => s.subagents[subagentId]?.assistantTexts[id]);

  if (!acc) return null;
  const cleaned = displayAssistantTurnText(acc.text);
  if (cleaned.length === 0 && acc.done) return null;

  const streaming = live && !acc.done;

  return (
    <span className={cn('vx-timeline-deleg-body-inline', streaming && 'vx-timeline-deleg-stream-live')}>
      {cleaned.length === 0 ? (
        <span className="inline-block h-4 w-16 animate-pulse rounded-inner bg-surface-overlay/30" aria-hidden />
      ) : (
        <StreamingMarkdownBody text={acc.text} done={acc.done} className="inline [&>*]:inline" />
      )}
      {streaming ? <span className="vx-timeline-deleg-caret" aria-hidden /> : null}
    </span>
  );
}
