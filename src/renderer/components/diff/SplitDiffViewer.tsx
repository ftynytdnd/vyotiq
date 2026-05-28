/**
 * Side-by-side diff renderer — pairs deleted lines on the left with added
 * lines on the right inside each hunk.
 */

import { useMemo } from 'react';
import type { DiffHunk as DiffHunkModel, DiffLine as DiffLineModel } from '@shared/types/tool.js';
import { chromeCodeSurfaceClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { DiffLine } from '../timeline/tools/edit/diff/DiffLine.js';
import {
  buildIntraLineMap,
  findLastStreamingLineIdx
} from '../timeline/tools/edit/diff/useIntraLineHighlight.js';
import type { DiffViewVariant } from '../timeline/tools/edit/diff/DiffHunk.js';
import type { ReviewLinePickProps } from '../timeline/tools/edit/diff/diffLinePick.js';

const MAX_VISIBLE_HUNKS = 30;
const MAX_VISIBLE_LINES_PER_HUNK = 200;

interface SplitDiffViewerProps {
  hunks: DiffHunkModel[];
  variant: DiffViewVariant;
  maxHeightClass?: string;
  linePick?: ReviewLinePickProps;
}

interface SplitRow {
  left: DiffLineModel | null;
  right: DiffLineModel | null;
  oldNo: number | null;
  newNo: number | null;
}

function buildSplitRows(hunk: DiffHunkModel): SplitRow[] {
  const rows: SplitRow[] = [];
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;

  for (const line of hunk.lines) {
    if (line.kind === ' ') {
      rows.push({ left: line, right: line, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
      continue;
    }
    if (line.kind === '-') {
      rows.push({ left: line, right: null, oldNo, newNo: null });
      oldNo += 1;
      continue;
    }
    rows.push({ left: null, right: line, oldNo: null, newNo });
    newNo += 1;
  }
  return rows;
}

export function SplitDiffViewer({
  hunks,
  variant,
  maxHeightClass = 'max-h-96',
  linePick
}: SplitDiffViewerProps) {
  const diffLinePick = useMemo(
    () =>
      linePick
        ? {
          highlightLine: linePick.highlightLine,
          onPick: (pick: { newLine: number | null; oldLine: number | null }) => {
            const n = pick.newLine ?? pick.oldLine;
            if (n !== null) linePick.onPick(n);
          }
        }
        : undefined,
    [linePick]
  );

  const visibleHunks = hunks.slice(0, MAX_VISIBLE_HUNKS);
  const overflowHunks = hunks.length - visibleHunks.length;

  const hunkBlocks = useMemo(
    () =>
      visibleHunks.map((hunk, hunkIdx) => {
        const visibleLines = hunk.lines.slice(0, MAX_VISIBLE_LINES_PER_HUNK);
        const hiddenLineCount = hunk.lines.length - visibleLines.length;
        const trimmedHunk = { ...hunk, lines: visibleLines };
        const splitRows = buildSplitRows(trimmedHunk);
        const lastStreamingIdx =
          variant === 'partial' ? findLastStreamingLineIdx(visibleLines) : -1;
        const intraLineMap = buildIntraLineMap(visibleLines, lastStreamingIdx);
        return { hunkIdx, hunk, splitRows, hiddenLineCount, intraLineMap, lastStreamingIdx };
      }),
    [visibleHunks, variant]
  );

  return (
    <div
      data-variant={variant}
      className={cn(
        'flex flex-col gap-2',
        chromeCodeSurfaceClassName('px-2 py-2'),
        maxHeightClass
      )}
    >
      <div className="scrollbar-stealth min-h-0 flex-1 overflow-y-auto">
        {hunkBlocks.map(({ hunkIdx, hunk, splitRows, hiddenLineCount, intraLineMap, lastStreamingIdx }) => (
          <div key={hunkIdx} className="mb-3 last:mb-0">
            <div className="sticky top-0 z-10 bg-surface-overlay/95 px-1 py-0.5 font-mono text-meta text-text-faint">
              @@ -{hunk.oldStart},{hunk.lines.length} +{hunk.newStart},{hunk.lines.length} @@
            </div>
            <div className="vx-diff-split-grid">
              <div className="vx-diff-split-pane min-w-0 border-r border-border-subtle/25">
                {splitRows.map((row, lineIdx) => {
                  const intra = row.left ? intraLineMap.get(lineIdx) : undefined;
                  const isTip =
                    row.left &&
                    (row.left.kind === '+' || row.left.kind === '-') &&
                    lineIdx === lastStreamingIdx;
                  return row.left ? (
                    <DiffLine
                      key={`l-${lineIdx}`}
                      line={row.left}
                      oldNo={row.oldNo}
                      newNo={null}
                      intra={intra}
                      isStreamingTip={isTip ?? undefined}
                      {...(diffLinePick ? { linePick: diffLinePick } : {})}
                    />
                  ) : (
                    <div key={`l-${lineIdx}`} className="vx-diff-split-placeholder" aria-hidden />
                  );
                })}
              </div>
              <div className="vx-diff-split-pane min-w-0">
                {splitRows.map((row, lineIdx) => {
                  const intra = row.right ? intraLineMap.get(lineIdx) : undefined;
                  const isTip =
                    row.right &&
                    (row.right.kind === '+' || row.right.kind === '-') &&
                    lineIdx === lastStreamingIdx;
                  return row.right ? (
                    <DiffLine
                      key={`r-${lineIdx}`}
                      line={row.right}
                      oldNo={null}
                      newNo={row.newNo}
                      intra={intra}
                      isStreamingTip={isTip ?? undefined}
                      {...(diffLinePick ? { linePick: diffLinePick } : {})}
                    />
                  ) : (
                    <div key={`r-${lineIdx}`} className="vx-diff-split-placeholder" aria-hidden />
                  );
                })}
              </div>
            </div>
            {hiddenLineCount > 0 && (
              <div className="px-2 py-0.5 text-meta italic text-text-faint">
                … {hiddenLineCount} more line{hiddenLineCount === 1 ? '' : 's'} in this hunk
              </div>
            )}
          </div>
        ))}
        {overflowHunks > 0 && (
          <div className="px-2 py-0.5 text-meta italic text-text-faint">
            … {overflowHunks} more hunk{overflowHunks === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </div>
  );
}
