/**
 * Live-streaming summary view surfaced inside the Inspector while a
 * summarization is mid-stream.
 *
 * Visual contract: matches `ContextSummaryRow` — gold phase headline
 * while compressing, `StreamingMarkdownBody` for live/settled prose.
 */

import { cn } from '../../lib/cn.js';
import { useChatStore } from '../../store/useChatStore.js';
import { useContextSummaryStore } from '../../store/useContextSummaryStore.js';
import { useToastStore } from '../../store/useToastStore.js';
import { Button } from '../ui/Button.js';
import { Eyebrow } from '../ui/Eyebrow.js';
import { chromeBadgeClassName, SurfaceShell } from '../ui/SurfaceShell.js';
import { formatTokenCount } from '../../lib/formatTokens.js';
import { StreamingMarkdownBody } from '../timeline/markdown/StreamingMarkdownBody.js';
import { timelinePhaseHeadingClassName } from '../timeline/shared/rowStyles.js';

interface LiveStreamCardProps {
  summaryId: string;
  conversationId: string;
}

export function LiveStreamCard({ summaryId, conversationId }: LiveStreamCardProps) {
  const acc = useChatStore(
    (s) => s.slices[conversationId]?.summaries[summaryId] ?? s.summaries[summaryId]
  );
  const inspectorMode = useContextSummaryStore((s) => s.mode);
  const boundId = useContextSummaryStore((s) => s.boundId);
  const abortIdle = useContextSummaryStore((s) => s.abortIdle);
  const abortLiveSummary = useContextSummaryStore((s) => s.abortLiveSummary);
  const busy = useContextSummaryStore((s) => s.busy);
  const showToast = useToastStore((s) => s.show);
  if (!acc) return null;
  const isLiveCompressing = acc.status === 'pending' || acc.status === 'streaming';
  const headline = (() => {
    const count = acc.replacedMessageIds.length;
    switch (acc.status) {
      case 'pending':
      case 'streaming':
        return `Compressing ${count} message${count === 1 ? '' : 's'}…`;
      case 'ended': {
        const saved =
          typeof acc.savedPercent === 'number' && acc.savedPercent > 0
            ? `${acc.savedPercent.toFixed(1)}%`
            : '0%';
        return `Compressed ${count} message${count === 1 ? '' : 's'} (${saved} saved)`;
      }
      case 'aborted':
        return 'Summarization aborted';
    }
  })();
  const dotTone = (() => {
    switch (acc.status) {
      case 'pending':
      case 'streaming':
        return 'bg-warning-strong';
      case 'ended':
        return 'bg-success-strong';
      case 'aborted':
        return 'bg-danger-strong';
    }
  })();
  const body = acc.status === 'ended' && acc.finalText ? acc.finalText : acc.text;
  const headlineTone = acc.status === 'aborted' ? 'text-danger' : undefined;

  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle/30 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <Eyebrow as="span" bold>
          Live summary
        </Eyebrow>
        <span
          aria-hidden
          className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', dotTone)}
        />
        <span
          className={cn(
            'text-row',
            isLiveCompressing
              ? cn(timelinePhaseHeadingClassName(true), 'truncate')
              : cn('text-text-secondary', headlineTone)
          )}
        >
          {headline}
        </span>
        {acc.status === 'ended' && typeof acc.afterTokens === 'number' && (
          <span className="ml-auto font-mono text-meta text-text-faint">
            {formatTokenCount(acc.beforeTokens)} → {formatTokenCount(acc.afterTokens)} tok
          </span>
        )}
        {acc.undone && (
          <span className={cn(chromeBadgeClassName, 'ml-auto')}>Undone</span>
        )}
      </div>
      {acc.reasoningText.length > 0 && acc.status !== 'aborted' && (
        <div className="flex flex-col gap-1">
          <Eyebrow as="span">Reasoning</Eyebrow>
          <SurfaceShell padded padding="nested">
            <pre className="whitespace-pre-wrap break-words font-mono text-row italic text-text-faint">
              {acc.reasoningText}
            </pre>
          </SurfaceShell>
        </div>
      )}
      {body.length > 0 && acc.status !== 'aborted' && (
        <div className="flex flex-col gap-1">
          <Eyebrow as="span">
            {acc.status === 'ended' ? 'Compressed body' : 'Live body'}
          </Eyebrow>
          <SurfaceShell padded padding="nested">
            <div className="scrollbar-stealth max-h-[28vh] overflow-y-auto">
              <StreamingMarkdownBody
                text={body}
                done={acc.status === 'ended'}
                className="text-row text-text-secondary"
              />
            </div>
          </SurfaceShell>
        </div>
      )}
      {acc.status === 'aborted' && acc.reason && (
        <div className="text-row text-danger">{acc.reason}</div>
      )}
      {isLiveCompressing && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => {
              const cancel =
                inspectorMode === 'live' && boundId
                  ? abortLiveSummary()
                  : abortIdle();
              void cancel.then((result) => {
                if (result.ok) showToast('Summarization cancelled.', 'success');
              });
            }}
          >
            Cancel summary
          </Button>
        </div>
      )}
    </div>
  );
}
