/**
 * Card-body diff — syntax-highlighted snippets without unified-diff chrome.
 */

import { memo, useId, useMemo } from 'react';
import type { DiffHunk } from '@shared/types/tool.js';
import { languageFromPath } from '@shared/text/languageFromPath.js';
import { cn } from '../../lib/cn.js';
import { useTimelineUiStore } from '../../store/useTimelineUiStore.js';
import type { DiffViewVariant } from '../timeline/tools/edit/diff/DiffHunk.js';
import {
  buildSnippetItems,
  findLastChangedLineIndex,
  hunksToChangedSnippet
} from './extractSnippetItems.js';
import { SnippetDiffLine } from './SnippetDiffLine.js';
import { DiffCopyButton } from '../timeline/tools/edit/diff/DiffCopyButton.js';

const EMPTY_FOLD_SET: ReadonlySet<string> = new Set();

export interface SnippetDiffBodyProps {
  hunks: DiffHunk[];
  variant: DiffViewVariant;
  filePath?: string;
  maxHeightClass?: string;
}

export const SnippetDiffBody = memo(function SnippetDiffBody({
  hunks,
  variant,
  filePath,
  maxHeightClass = 'max-h-80'
}: SnippetDiffBodyProps) {
  const instanceId = useId();
  const foldScopeKey = `${instanceId}:snippet`;
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

  const streamingTipKey = useMemo(() => {
    if (variant !== 'partial') return null;
    const idx = findLastChangedLineIndex(safeHunks);
    if (idx === null) return null;
    let cursor = 0;
    for (let h = 0; h < safeHunks.length; h++) {
      const hunk = safeHunks[h]!;
      for (let i = 0; i < hunk.lines.length; i++) {
        if (cursor === idx) return `${h}:${i}`;
        cursor++;
      }
    }
    return null;
  }, [safeHunks, variant]);

  const copyText = useMemo(() => hunksToChangedSnippet(safeHunks), [safeHunks]);

  if (safeHunks.length === 0) {
    return (
      <div className="px-2.5 py-2 text-row text-text-muted">No textual changes.</div>
    );
  }

  return (
    <div
      data-variant={variant}
      data-snippet-diff
      className={cn('group/diff relative vx-snippet-diff-body overflow-y-auto', maxHeightClass)}
    >
      {variant !== 'partial' && copyText.trim().length > 0 ? (
        <DiffCopyButton text={copyText} />
      ) : null}
      {items.map((item, i) => {
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
        const tip =
          streamingTipKey !== null &&
          `${item.hunkIdx}:${item.lineIndex}` === streamingTipKey;
        return (
          <SnippetDiffLine
            key={`${item.hunkIdx}:${item.lineIndex}`}
            line={item.line}
            {...(language ? { language } : {})}
            isStreamingTip={tip}
          />
        );
      })}
      {hiddenLineCount > 0 && (
        <div className="px-2.5 py-1 font-mono text-meta italic text-text-faint">
          … {hiddenLineCount} more line{hiddenLineCount === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
});
