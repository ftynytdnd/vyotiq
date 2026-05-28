/**
 * Unified (single-column) diff body — hunk navigator, minimap, copy,
 * wrap toggle, and per-hunk caps. Split layout lives in `SplitDiffViewer`;
 * layout switching is owned by the shared `DiffViewer` shell.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DiffHunk as DiffHunkModel } from '@shared/types/tool.js';
import { chromeCodeSurfaceClassName } from '../ui/SurfaceShell.js';
import { cn } from '../../lib/cn.js';
import { DiffHunk, type DiffViewVariant } from '../timeline/tools/edit/diff/DiffHunk.js';
import { DiffNavigator } from '../timeline/tools/edit/diff/DiffNavigator.js';
import { DiffMinimap } from '../timeline/tools/edit/diff/DiffMinimap.js';
import { DiffCopyButton } from '../timeline/tools/edit/diff/DiffCopyButton.js';
import { hunksToPatch } from '../timeline/tools/edit/diff/hunksToPatch.js';
import type { ReviewLinePickProps } from '../timeline/tools/edit/diff/diffLinePick.js';

/** Cap on hunks rendered into the DOM per diff. */
const MAX_VISIBLE_HUNKS = 30;

export interface UnifiedDiffBodyProps {
  hunks: DiffHunkModel[];
  variant: DiffViewVariant;
  maxHeightClass?: string;
  linePick?: ReviewLinePickProps;
}

export function UnifiedDiffBody({
  hunks,
  variant,
  maxHeightClass = 'max-h-96',
  linePick
}: UnifiedDiffBodyProps) {
  const instanceId = useId();
  const [showAll, setShowAll] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [lineWrap, setLineWrap] = useState(true);

  const safeHunks = hunks ?? [];
  const visibleHunks = showAll ? safeHunks : safeHunks.slice(0, MAX_VISIBLE_HUNKS);
  const overflowHunks = safeHunks.length - visibleHunks.length;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hunkRefs = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    hunkRefs.current.length = visibleHunks.length;
  }, [visibleHunks.length]);

  const hunksResetKey = useMemo(() => {
    if (safeHunks.length === 0) return '0';
    const first = safeHunks[0]!;
    const last = safeHunks[safeHunks.length - 1]!;
    return `${safeHunks.length}:${first.oldStart}:${first.newStart}:${last.oldStart}:${last.newStart}`;
  }, [safeHunks]);

  useEffect(() => {
    setActiveIdx(0);
    setShowAll(false);
  }, [hunksResetKey]);

  const plainText = useMemo(() => hunksToPatch(hunks), [hunks]);

  const scrollHunkIntoView = useCallback((idx: number) => {
    const el = hunkRefs.current[idx];
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const onPrev = useCallback(() => {
    setActiveIdx((cur) => {
      const next = (cur - 1 + visibleHunks.length) % Math.max(visibleHunks.length, 1);
      scrollHunkIntoView(next);
      return next;
    });
  }, [scrollHunkIntoView, visibleHunks.length]);

  const onNext = useCallback(() => {
    setActiveIdx((cur) => {
      const next = (cur + 1) % Math.max(visibleHunks.length, 1);
      scrollHunkIntoView(next);
      return next;
    });
  }, [scrollHunkIntoView, visibleHunks.length]);

  const onJump = useCallback((idx: number) => {
    setActiveIdx(idx);
    scrollHunkIntoView(idx);
  }, [scrollHunkIntoView]);

  return (
    <div
      ref={containerRef}
      data-variant={variant}
      data-edit-diff-instance={instanceId}
      className={cn(
        'group/diff relative flex flex-col gap-2',
        chromeCodeSurfaceClassName('px-2 py-2'),
        maxHeightClass
      )}
    >
      {variant !== 'partial' && safeHunks.length > 0 && (
        <DiffCopyButton text={plainText} />
      )}
      <div className="sticky top-1.5 z-20 ml-auto flex items-center gap-1 self-end">
        <button
          type="button"
          onClick={() => setLineWrap((v) => !v)}
          className={cn('vx-diff-control px-2 py-0.5')}
          aria-pressed={lineWrap}
          title={lineWrap ? 'Disable line wrap' : 'Enable line wrap'}
        >
          {lineWrap ? 'Wrap' : 'No wrap'}
        </button>
        <DiffNavigator
          hunks={visibleHunks}
          activeIdx={activeIdx}
          onPrev={onPrev}
          onNext={onNext}
          onJump={onJump}
        />
      </div>
      <div className="flex min-h-0 flex-1 gap-1">
        <div className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
          {visibleHunks.map((hunk, i) => (
            <DiffHunk
              key={i}
              ref={(el) => {
                hunkRefs.current[i] = el;
              }}
              hunk={hunk}
              idx={i}
              variant={variant}
              foldScopeKey={`${instanceId}:hunk:${i}`}
              lineWrap={lineWrap}
              {...(linePick ? { linePick } : {})}
            />
          ))}
          {overflowHunks > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className={cn('vx-diff-control self-start px-2 py-0.5 italic')}
            >
              … {overflowHunks} more hunk{overflowHunks === 1 ? '' : 's'} — show all
            </button>
          )}
        </div>
        <DiffMinimap hunks={visibleHunks} activeIdx={activeIdx} onJump={onJump} />
      </div>
    </div>
  );
}
