/**
 * DiffViewer — modular replacement for the legacy inline `EditDiffView`
 * shell. Composes the smaller, single-responsibility units from the
 * `diff/` folder:
 *
 *   - `DiffHunk`       — per-hunk renderer (sticky header, line caps,
 *                        soft-fold, intra-line word-diff).
 *   - `DiffLine`       — per-row renderer (kind colour, gutter cells,
 *                        intra-line highlight, streaming cursor).
 *   - `DiffNavigator`  — sticky prev / next + jump-menu (only renders
 *                        when there are 2+ hunks).
 *   - `DiffCopyButton` — hover-revealed copy-as-patch affordance.
 *   - `hunksToPatch`   — pure unified-diff serialiser used for copy.
 *
 * The original `EditDiffView` is preserved as a thin compatibility
 * shim that delegates to this component, so every existing call site
 * (timeline `EditInvocation`, pending-changes panel, edit approval
 * dialog, bash/delete diff streams, sub-agent panels) keeps working
 * without changes.
 *
 * Variants:
 *   - `'authoritative'` — settled `result.data.hunks`. Triggers the
 *      staggered settle animation on each hunk.
 *   - `'preview'`       — synthesized from `oldString` / `newString`
 *      while a tool call is in flight (no settle animation).
 *   - `'partial'`       — streaming live-diff snapshot from the main
 *      process (FS-aware diff). Renders the trailing blinking
 *      streaming cursor on the last `+` / `-` line.
 *
 * Caps:
 *   - `MAX_VISIBLE_HUNKS = 30` (DOM cap for hunks)
 *   - `MAX_VISIBLE_LINES_PER_HUNK = 200` (re-exported from `DiffHunk`)
 *
 * Both caps preserve the existing behaviour the test suite pins via
 * the "20 more hunks — show all" + "50 more lines in this hunk"
 * assertions.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DiffHunk as DiffHunkModel } from '@shared/types/tool.js';
import { cn } from '../../../../../lib/cn.js';
import { DiffHunk, type DiffViewVariant } from './DiffHunk.js';
import { DiffNavigator } from './DiffNavigator.js';
import { DiffCopyButton } from './DiffCopyButton.js';
import { hunksToPatch } from './hunksToPatch.js';

/** Cap on hunks rendered into the DOM per diff. */
const MAX_VISIBLE_HUNKS = 30;

interface DiffViewerProps {
  hunks: DiffHunkModel[];
  variant: DiffViewVariant;
  /**
   * Maximum container height. Defaults to the historical 24rem
   * (`max-h-96`) so existing call sites are unaffected. The
   * pending-changes review modal raises this to make full-screen
   * review comfortable.
   */
  maxHeightClass?: string;
}

export function DiffViewer({
  hunks,
  variant,
  maxHeightClass = 'max-h-96'
}: DiffViewerProps) {
  const instanceId = useId();
  const [showAll, setShowAll] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const visibleHunks = showAll ? hunks : hunks.slice(0, MAX_VISIBLE_HUNKS);
  const overflowHunks = hunks.length - visibleHunks.length;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hunkRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Reset the ref array length on hunk-count changes so a re-mount
  // with a smaller diff doesn't leak references to torn-down nodes.
  useEffect(() => {
    hunkRefs.current.length = visibleHunks.length;
  }, [visibleHunks.length]);

  // Reset showAll + activeIdx when the underlying hunks identity
  // flips (e.g. partial → authoritative on settle). Avoids stale
  // pointer to a hunk that no longer exists.
  useEffect(() => {
    setActiveIdx(0);
    setShowAll(false);
  }, [hunks]);

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
        'group/diff scrollbar-stealth relative flex flex-col gap-2',
        'overflow-auto rounded-inner bg-surface-overlay px-2 py-2',
        maxHeightClass
      )}
    >
      {variant !== 'partial' && hunks.length > 0 && (
        <DiffCopyButton text={plainText} />
      )}
      <DiffNavigator
        hunks={visibleHunks}
        activeIdx={activeIdx}
        onPrev={onPrev}
        onNext={onNext}
        onJump={onJump}
      />
      {visibleHunks.map((hunk, i) => (
        <DiffHunk
          key={i}
          ref={(el) => {
            hunkRefs.current[i] = el;
          }}
          hunk={hunk}
          idx={i}
          variant={variant}
        />
      ))}
      {overflowHunks > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className={cn(
            'self-start rounded-inner px-2 py-0.5 text-meta italic',
            'text-text-faint hover:text-text-secondary hover:bg-surface-hover',
            'transition-colors duration-150'
          )}
        >
          … {overflowHunks} more hunk{overflowHunks === 1 ? '' : 's'} — show all
        </button>
      )}
    </div>
  );
}
