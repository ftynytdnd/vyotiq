/**
 * Renders ONE hunk inside a `DiffViewer`. Owns:
 *
 *   - The sticky `@@ -old +new @@` header.
 *   - The per-hunk DOM cap (`MAX_VISIBLE_LINES_PER_HUNK = 200`)
 *     with the trailing "… N more lines in this hunk" overflow row.
 *   - Soft-fold collapse for long unchanged-context runs (`softFold.ts`).
 *   - Intra-line word-diff highlighting for adjacent `-` / `+`
 *     pairs (`useIntraLineHighlight.ts`).
 *   - The settle-animation custom property (`--vyotiq-hunk-idx`)
 *     that drives the staggered keyframe in `index.css` for
 *     authoritative diffs.
 *
 * Inputs are deliberately narrow — `hunk`, `idx`, `variant`, plus
 * a `forwardElement` ref so the parent navigator can scroll a
 * specific hunk into view without coupling to the DOM structure.
 */

import { forwardRef, useMemo, useState } from 'react';
import type { DiffHunk as DiffHunkModel } from '@shared/types/tool.js';
import { cn } from '../../../../../lib/cn.js';
import { DiffLine } from './DiffLine.js';
import {
  buildIntraLineMap,
  findLastStreamingLineIdx
} from './useIntraLineHighlight.js';
import { buildFoldedItems } from './softFold.js';

/** Cap on lines rendered inside a single hunk's `<pre>`. */
const MAX_VISIBLE_LINES_PER_HUNK = 200;

export type DiffViewVariant = 'preview' | 'authoritative' | 'partial';

interface DiffHunkProps {
  hunk: DiffHunkModel;
  idx: number;
  variant: DiffViewVariant;
}

export const DiffHunk = forwardRef<HTMLDivElement, DiffHunkProps>(
  function DiffHunk({ hunk, idx, variant }, ref) {
    // Per-hunk fold-expansion memory. Keyed by the same `foldId`
    // strings `buildFoldedItems` produces so the user's "expand"
    // clicks survive intra-hunk re-renders driven by parent state
    // (e.g. the navigator setting an active hunk).
    const [expandedFolds, setExpandedFolds] = useState<ReadonlySet<string>>(
      () => new Set()
    );

    const visibleLines = hunk.lines.slice(0, MAX_VISIBLE_LINES_PER_HUNK);
    const hiddenLineCount = hunk.lines.length - visibleLines.length;

    // Staggered settle is reserved for authoritative diffs. Preview
    // and partial diffs already have row-level shimmer signalling
    // in-flight state; layering settle on top would read as a
    // double-animation.
    const settle = variant === 'authoritative';

    // In `partial` mode, the very last `+` or `-` line is the one
    // the model is actively streaming bytes into. We tag it so we
    // can render a trailing blinking cursor at its tail.
    const lastStreamingIdx = useMemo(
      () =>
        variant === 'partial' ? findLastStreamingLineIdx(visibleLines) : -1,
      [visibleLines, variant]
    );

    const intraLineMap = useMemo(
      () => buildIntraLineMap(visibleLines, lastStreamingIdx),
      [visibleLines, lastStreamingIdx]
    );

    const foldedItems = useMemo(
      () => buildFoldedItems(visibleLines, idx, expandedFolds),
      [visibleLines, idx, expandedFolds]
    );

    // Walk old/new line numbers in sync with the visible items.
    let oldCursor = hunk.oldStart;
    let newCursor = hunk.newStart;

    return (
      <div
        ref={ref}
        data-hunk-idx={idx}
        className={cn('flex flex-col', settle && 'vyotiq-diff-settle')}
        style={
          settle
            ? ({ '--vyotiq-hunk-idx': idx } as React.CSSProperties)
            : undefined
        }
      >
        <div className="sticky top-0 z-[1] bg-surface-overlay px-1 font-mono text-meta text-text-faint">
          @@ -{hunk.oldStart} +{hunk.newStart} @@
        </div>
        <pre className="whitespace-pre font-mono text-row leading-relaxed">
          {foldedItems.map((item) => {
            if (item.kind === 'fold') {
              return (
                <button
                  key={item.foldId}
                  type="button"
                  onClick={() => {
                    setExpandedFolds((prev) => {
                      const next = new Set(prev);
                      next.add(item.foldId);
                      return next;
                    });
                  }}
                  className={cn(
                    'mx-1 my-0.5 flex w-[calc(100%-0.5rem)] items-center gap-2',
                    'rounded-inner border border-dashed border-border-subtle/40',
                    'px-2 py-0.5 text-meta italic text-text-faint',
                    'transition-colors duration-150',
                    'hover:border-border-subtle hover:bg-surface-hover hover:text-text-secondary'
                  )}
                >
                  … {item.hidden} unchanged line{item.hidden === 1 ? '' : 's'} — expand
                </button>
              );
            }
            const { line, lineIndex } = item;
            // Compute gutter line numbers from the running cursors.
            // `+` lines advance only `newCursor`; `-` lines advance
            // only `oldCursor`; ` ` advances both.
            let oldNo: number | null = null;
            let newNo: number | null = null;
            if (line.kind === ' ') {
              oldNo = oldCursor;
              newNo = newCursor;
              oldCursor++;
              newCursor++;
            } else if (line.kind === '+') {
              newNo = newCursor;
              newCursor++;
            } else if (line.kind === '-') {
              oldNo = oldCursor;
              oldCursor++;
            }
            const intra = intraLineMap.get(lineIndex);
            const isStreamingTip = lineIndex === lastStreamingIdx;
            return (
              <DiffLine
                key={lineIndex}
                line={line}
                oldNo={oldNo}
                newNo={newNo}
                {...(intra ? { intra } : {})}
                {...(isStreamingTip ? { isStreamingTip } : {})}
              />
            );
          })}
        </pre>
        {hiddenLineCount > 0 && (
          <div className="px-1 font-mono text-meta italic text-text-faint">
            … {hiddenLineCount} more line{hiddenLineCount === 1 ? '' : 's'} in this hunk
          </div>
        )}
      </div>
    );
  }
);
