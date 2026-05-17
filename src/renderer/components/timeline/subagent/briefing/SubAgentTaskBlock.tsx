/**
 * SubAgentTaskBlock — full-task renderer for the sub-agent Briefing.
 *
 * The orchestrator's `<delegate task="…" />` directive carries the
 * worker's instruction prose. The collapsed sub-agent row truncates
 * it to ~96 chars (so the timeline scrolls cleanly), and the
 * historical `SubAgentHeader` had also dropped the task entirely
 * once expanded — leaving the user without a way to see the full
 * brief without diving into the harness.
 *
 * This component owns the canonical full-task surface inside the
 * Briefing panel:
 *   - Markdown-rendered task body (the model often writes lists
 *     and emphasis inside the task string).
 *   - Soft 12-line collapse with a `Show full task` toggle for very
 *     long briefs.
 *   - One-click `Copy task` affordance, mount-guarded so a fast
 *     unmount during the success-state debounce can't leak its
 *     `setTimeout` or call `setState` on a torn-down component.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ClipboardList, Copy } from 'lucide-react';
import { stripEmoji } from '@shared/text/emoji.js';
import { MarkdownBody } from '../../markdown/MarkdownBody.js';
import { DetailPane } from '../../tools/shared/DetailPane.js';
import { cn } from '../../../../lib/cn.js';
import { safeCopy } from '../../../../lib/clipboard.js';

interface SubAgentTaskBlockProps {
  task: string;
}

/** Lines visible before the soft-collapse toggle appears. */
const VISIBLE_LINE_CAP = 12;
const COPY_FEEDBACK_MS = 1200;

export function SubAgentTaskBlock({ task }: SubAgentTaskBlockProps) {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };
  }, []);

  // Soft-collapse is line-driven, not character-driven, so a
  // multi-line bullet list doesn't get visually shredded by a
  // raw character cap. We only run the slice when the task is
  // actually long enough to need it.
  const { displayed, totalLines, isClipped } = useMemo(() => {
    const stripped = stripEmoji(task);
    const lines = stripped.split('\n');
    if (showAll || lines.length <= VISIBLE_LINE_CAP) {
      return { displayed: stripped, totalLines: lines.length, isClipped: false };
    }
    return {
      displayed: lines.slice(0, VISIBLE_LINE_CAP).join('\n'),
      totalLines: lines.length,
      isClipped: true
    };
  }, [task, showAll]);

  const onCopy = () => {
    void safeCopy(stripEmoji(task), { context: 'sub-agent-task' }).then((ok) => {
      if (!ok || !mountedRef.current) return;
      setCopied(true);
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        resetTimerRef.current = null;
        setCopied(false);
      }, COPY_FEEDBACK_MS);
    });
  };

  return (
    <DetailPane label="task">
      <div className="group/task relative rounded-inner border border-border-subtle/40 bg-surface-overlay/60 px-3 py-2">
        <button
          type="button"
          onClick={onCopy}
          title={copied ? 'Copied task' : 'Copy task'}
          aria-label={copied ? 'Copied task' : 'Copy task'}
          className={cn(
            'absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-inner',
            'text-text-faint transition-opacity duration-150',
            'opacity-0 group-hover/task:opacity-100 focus:opacity-100',
            'hover:bg-surface-hover hover:text-text-secondary'
          )}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" strokeWidth={2.25} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2.25} />
          )}
        </button>
        <div className="flex items-start gap-2">
          <ClipboardList
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
            strokeWidth={2}
          />
          <MarkdownBody
            text={displayed}
            className="min-w-0 flex-1 text-log leading-relaxed text-text-secondary"
          />
        </div>
        {isClipped && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className={cn(
              'mt-1 rounded-inner px-1.5 py-0.5 text-meta italic',
              'text-text-faint hover:text-text-secondary hover:bg-surface-hover',
              'transition-colors duration-150'
            )}
          >
            Show full task — {totalLines - VISIBLE_LINE_CAP} more line
            {totalLines - VISIBLE_LINE_CAP === 1 ? '' : 's'}
          </button>
        )}
        {showAll && totalLines > VISIBLE_LINE_CAP && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className={cn(
              'mt-1 rounded-inner px-1.5 py-0.5 text-meta italic',
              'text-text-faint hover:text-text-secondary hover:bg-surface-hover',
              'transition-colors duration-150'
            )}
          >
            Show less
          </button>
        )}
      </div>
    </DetailPane>
  );
}
