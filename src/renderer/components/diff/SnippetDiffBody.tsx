/**
 * Card-body diff — virtualized, syntax-highlighted snippets with
 * intra-line word highlights on adjacent `-` / `+` pairs.
 */

import { memo, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffHunk } from '@shared/types/tool.js';
import { languageFromPath } from '@shared/text/languageFromPath.js';
import { cn } from '../../lib/cn.js';
import { useTimelineUiStore } from '../../store/useTimelineUiStore.js';
import type { DiffViewVariant } from '../timeline/tools/edit/diff/DiffHunk.js';
import { buildIntraLineMap } from '../timeline/tools/edit/diff/useIntraLineHighlight.js';
import {
  buildSnippetItems,
  hunksToChangedSnippet,
  type SnippetItem
} from './extractSnippetItems.js';
import { SnippetDiffLine } from './SnippetDiffLine.js';
import { DiffCopyButton } from '../timeline/tools/edit/diff/DiffCopyButton.js';

const EMPTY_FOLD_SET: ReadonlySet<string> = new Set();
const LINE_ESTIMATE_PX = 22;
const FOLD_ESTIMATE_PX = 28;
/** Below this line count, a plain list is cheaper than virtualizer setup. */
const VIRTUALIZE_LINE_THRESHOLD = 64;

export interface SnippetDiffBodyProps {
  hunks: DiffHunk[];
  variant: DiffViewVariant;
  filePath?: string;
  maxHeightClass?: string;
  /** Brief crossfade when handoff from preview → FS-aware stream. */
  handoff?: boolean;
  /** Root-level streaming cards hide the blinking tail cursor (GIF-faithful). */
  hideStreamCursor?: boolean;
}

export const SnippetDiffBody = memo(function SnippetDiffBody({
  hunks,
  variant,
  filePath,
  maxHeightClass = 'max-h-80',
  handoff = false,
  hideStreamCursor = false
}: SnippetDiffBodyProps) {
  const instanceId = useId();
  const foldScopeKey = `${instanceId}:snippet`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const expandedFolds = useTimelineUiStore(
    (s) => s.diffFoldExpandedByScope[foldScopeKey] ?? EMPTY_FOLD_SET
  );
  const toggleDiffFold = useTimelineUiStore((s) => s.toggleDiffFold);

  const language = useMemo(
    () => (filePath ? languageFromPath(filePath) : undefined),
    [filePath]
  );

  const safeHunks = hunks ?? [];
  const { items, hiddenLineCount } = useMemo(
    () => buildSnippetItems(safeHunks, expandedFolds),
    [safeHunks, expandedFolds]
  );

  const intraMaps = useMemo(
    () => safeHunks.map((hunk) => buildIntraLineMap(hunk.lines, -1)),
    [safeHunks]
  );

  const lastLineItemIndex = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]?.kind === 'line') return i;
    }
    return -1;
  }, [items]);

  const copyText = useMemo(() => hunksToChangedSnippet(safeHunks), [safeHunks]);

  const shouldVirtualize = items.length > VIRTUALIZE_LINE_THRESHOLD;

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? items.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      items[index]?.kind === 'fold' ? FOLD_ESTIMATE_PX : LINE_ESTIMATE_PX,
    overscan: 12
  });

  useLayoutEffect(() => {
    if (!shouldVirtualize || items.length === 0 || !scrollRef.current) return;
    virtualizer.measure();
  }, [shouldVirtualize, items.length, virtualizer]);

  useLayoutEffect(() => {
    if (variant !== 'partial' || items.length === 0 || !scrollRef.current) return;
    const el = scrollRef.current;
    if (el.scrollHeight > el.clientHeight) {
      el.scrollTop = el.scrollHeight;
    }
  }, [variant, items.length, lastLineItemIndex]);

  if (safeHunks.length === 0) {
    return (
      <div className="px-2.5 py-2 text-row text-text-muted">No textual changes.</div>
    );
  }

  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];
  const measuring = shouldVirtualize && virtualItems.length === 0 && items.length > 0;

  const renderItem = (item: SnippetItem, i: number) => {
    if (item.kind === 'fold') {
      if (item.hidden === 0) return null;
      return (
        <button
          key={`${item.foldId}-${i}`}
          type="button"
          onClick={() => toggleDiffFold(foldScopeKey, item.foldId)}
          className="vx-snippet-diff-fold w-full px-2.5 py-1 text-left font-mono text-meta text-text-faint"
        >
          … {item.hidden} unchanged line{item.hidden === 1 ? '' : 's'} — expand
        </button>
      );
    }
    const intra = intraMaps[item.hunkIdx]?.get(item.lineIndex);
    return (
      <SnippetDiffLine
        key={`${item.hunkIdx}:${item.lineIndex}`}
        line={item.line}
        {...(language ? { language } : {})}
        {...(intra ? { intra } : {})}
        isStreamingTip={
          variant === 'partial' && item.kind === 'line' && i === lastLineItemIndex
        }
        hideStreamCursor={hideStreamCursor}
      />
    );
  };

  return (
    <div
      data-variant={variant}
      data-snippet-diff
      className={cn(
        'group/diff relative vx-snippet-diff-body',
        handoff && 'vyotiq-diff-handoff',
        maxHeightClass
      )}
    >
      {variant !== 'partial' && copyText.trim().length > 0 ? (
        <DiffCopyButton text={copyText} />
      ) : null}
      <div
        ref={scrollRef}
        className={cn('overflow-y-auto', maxHeightClass)}
        data-snippet-diff-scroll
      >
        {shouldVirtualize ? (
          measuring ? (
            <div
              className="vx-snippet-diff-measuring"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
              aria-busy="true"
            />
          ) : (
            <div
              className="relative w-full"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
              {virtualItems.map((virtualRow) => {
                const item = items[virtualRow.index]!;
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {renderItem(item, virtualRow.index)}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          items.map((item, i) => renderItem(item, i))
        )}
      </div>
      {hiddenLineCount > 0 && (
        <div className="px-2.5 py-1 font-mono text-meta italic text-text-faint">
          … {hiddenLineCount} more line{hiddenLineCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
});
