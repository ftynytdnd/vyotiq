/**
 * Inline timeline card for a context-summarization lifecycle.
 *
 * Anchors to the `context-summary-pending` event in `deriveRows`;
 * subscribes by `summaryId` to `useChatStore.summaries[id]` so
 * streaming `context-summary-delta` / `-reasoning-delta` events
 * paint without re-deriving the row list.
 *
 * Four visual states match the accumulator's `status`:
 *
 *   - `pending`  — yellow dot + "Compressing N messages…" with a
 *     shimmer until the first delta lands.
 *   - `streaming` — same headline plus a faint "tok/s" readout
 *     and the live-accumulating final body in a 3-line preview.
 *   - `ended`    — green dot + "Compressed N messages → ~M tokens
 *     saved (X%)". Click expands the full body. Inline "Undo"
 *     button when the run is still live AND `undone === false`.
 *   - `aborted`  — red dot + the failure reason. No expand.
 *
 * The `undone` flag overlays a "Undone" badge regardless of
 * `status` so the user can see they've reverted a previously
 * applied splice.
 *
 * No card UI in the row; the wrapper inherits the timeline's
 * existing rail tone tokens. The body expander uses the same
 * `Disclosure` pattern as `ReasoningLineRow`.
 */

import { useState } from 'react';
import { ChevronRight, Layers, Sparkles, Undo2 } from 'lucide-react';
import { cn } from '../../../lib/cn.js';
import { shimmerStyle, shimmerText } from '../../../lib/shimmer.js';
import type { ContextSummaryAcc } from '../reducer/types.js';
import { useChatStore } from '../../../store/useChatStore.js';
import { useContextSummaryStore } from '../../../store/useContextSummaryStore.js';

interface ContextSummaryRowProps {
  summaryId: string;
  /** True while the enclosing run is still streaming. Drives the
   *  shimmer on `pending` / `streaming` and gates the Undo button. */
  live?: boolean;
}

const PREVIEW_LINES = 3;

function pickBodyForPreview(acc: ContextSummaryAcc): string {
  if (acc.status === 'ended' && acc.finalText) return acc.finalText;
  return acc.text;
}

function pickHeadline(acc: ContextSummaryAcc): string {
  const count = acc.replacedMessageIds.length;
  switch (acc.status) {
    case 'pending':
      return `Compressing ${count} message${count === 1 ? '' : 's'}…`;
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
      return `Summarization aborted`;
  }
}

function pickToneClasses(acc: ContextSummaryAcc): {
  dot: string;
  text: string;
} {
  switch (acc.status) {
    case 'pending':
    case 'streaming':
      return { dot: 'bg-warning/80', text: 'text-text-secondary' };
    case 'ended':
      return { dot: 'bg-success/80', text: 'text-text-secondary' };
    case 'aborted':
      return { dot: 'bg-danger/80', text: 'text-danger' };
  }
}

export function ContextSummaryRow({ summaryId, live = false }: ContextSummaryRowProps) {
  const acc = useChatStore((s) => s.summaries[summaryId]);
  const undo = useContextSummaryStore((s) => s.undo);
  const busy = useContextSummaryStore((s) => s.busy);
  const [expanded, setExpanded] = useState(false);

  // Defensive: a `context-summary-end` could land before its
  // matching `pending` was applied (highly unlikely — both come
  // from the same `emit` queue — but the reducer treats it as a
  // no-op on the accumulator, so the row would render against
  // `undefined`). Render nothing in that edge case so the
  // timeline doesn't ship an orphaned shimmer line.
  if (!acc) return null;

  const tone = pickToneClasses(acc);
  const headline = pickHeadline(acc);
  const previewBody = pickBodyForPreview(acc);
  const previewLines = previewBody.split('\n').slice(0, PREVIEW_LINES);
  const hasMoreLines = previewBody.split('\n').length > PREVIEW_LINES;
  const canExpand = acc.status === 'ended' || acc.status === 'streaming';
  const isShimmering = live && (acc.status === 'pending' || acc.status === 'streaming');
  const showUndoButton =
    live &&
    acc.status === 'ended' &&
    !acc.undone;

  return (
    <div className="rounded-inner px-1 py-1">
      <div className="flex items-start gap-1.5">
        <span
          aria-hidden
          className={cn(
            'mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full',
            tone.dot
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Layers className="h-3 w-3 shrink-0 text-text-faint" strokeWidth={2} />
            <button
              type="button"
              onClick={() => canExpand && setExpanded((v) => !v)}
              disabled={!canExpand}
              aria-expanded={expanded}
              className={cn(
                'inline-flex items-center gap-0.5 text-meta',
                canExpand
                  ? 'cursor-pointer hover:text-text-primary'
                  : 'cursor-default',
                tone.text
              )}
              title={
                acc.status === 'aborted'
                  ? acc.reason ?? 'Summarization failed'
                  : `${acc.beforeTokens.toLocaleString()} → ${(
                      acc.afterTokens ?? 0
                    ).toLocaleString()} tokens`
              }
            >
              {canExpand && (
                <ChevronRight
                  className={cn(
                    'h-3 w-3 shrink-0 transition-transform duration-150',
                    expanded ? 'rotate-90' : 'rotate-0'
                  )}
                  strokeWidth={2}
                />
              )}
              <span
                className={shimmerText(isShimmering)}
                style={isShimmering ? shimmerStyle(`summary:${summaryId}`) : undefined}
              >
                {headline}
              </span>
            </button>
            {acc.undone && (
              <span className="rounded-inner bg-surface-overlay px-1 text-meta text-text-muted">
                Undone
              </span>
            )}
            {acc.status === 'ended' && typeof acc.afterTokens === 'number' && (
              <span className="font-mono text-meta text-text-faint">
                {acc.beforeTokens.toLocaleString()} → {acc.afterTokens.toLocaleString()} tok
              </span>
            )}
            {showUndoButton && (
              <button
                type="button"
                onClick={() => void undo(summaryId)}
                disabled={busy}
                title="Restore the messages this summary replaced. Only valid until the next user prompt."
                className={cn(
                  'ml-auto inline-flex items-center gap-0.5 rounded-inner bg-surface-overlay px-1.5 py-0.5 text-meta',
                  'text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary',
                  busy && 'opacity-50'
                )}
              >
                <Undo2 className="h-3 w-3" strokeWidth={2} />
                Undo
              </button>
            )}
          </div>
          {/* Reasoning preview while streaming — kept faint so it
              doesn't compete with the body. */}
          {acc.status === 'streaming' && acc.reasoningText.length > 0 && (
            <div className="mt-0.5 flex items-start gap-1 text-meta italic text-text-faint">
              <Sparkles className="mt-[3px] h-2.5 w-2.5 shrink-0" strokeWidth={2} />
              <span className="line-clamp-2">{acc.reasoningText}</span>
            </div>
          )}
          {/* Streaming preview body. Shown only when there's
              SOMETHING to preview — empty pending state stays
              clean. */}
          {previewBody.length > 0 && !expanded && (
            <pre className="mt-1 whitespace-pre-wrap break-words text-log text-text-muted">
              {previewLines.join('\n')}
              {hasMoreLines && '\n…'}
            </pre>
          )}
          {/* Full expanded body — shown only when the user clicks
              the headline. Same prose tone as the preview but
              with the entire compressed body. */}
          {expanded && previewBody.length > 0 && (
            <pre className="mt-1 max-h-[480px] overflow-y-auto whitespace-pre-wrap break-words rounded-inner bg-surface-raised/60 p-2 text-log text-text-secondary">
              {previewBody}
            </pre>
          )}
          {acc.status === 'aborted' && acc.reason && (
            <div className="mt-0.5 text-meta text-danger/80">{acc.reason}</div>
          )}
        </div>
      </div>
    </div>
  );
}
