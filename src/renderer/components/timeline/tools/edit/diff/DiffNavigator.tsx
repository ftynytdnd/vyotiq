/**
 * DiffNavigator — sticky prev/next + jump menu placed in the
 * diff viewer when more than one hunk is present. Inert when
 * `hunkCount <= 1`.
 *
 * Behaviour:
 *   - Prev / Next walk the hunk list with wraparound.
 *   - The center label shows the active hunk's 1-based index and
 *     its `@@ -old +new @@` range (compact form: `12 ↦ 18`).
 *   - The label itself is the trigger for a popover-style jump
 *     menu listing every hunk with its old/new range; clicking a
 *     row sets the active hunk.
 *
 * State is owned by the parent (`DiffViewer`) so keyboard scrolling
 * and click-driven navigation share one source of truth. The
 * navigator only renders the controls and emits `onPrev` / `onNext`
 * / `onJump` callbacks. Side-effects (scroll the matching hunk
 * into view) live in `DiffViewer`.
 *
 * Memory-leak hygiene: the popover registers its outside-click
 * listener inside `useEffect` and always cleans it up; closing
 * the menu (Esc / outside click / row click) restores focus to
 * the trigger button.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ListOrdered } from 'lucide-react';
import type { DiffHunk } from '@shared/types/tool.js';
import { cn } from '../../../../../lib/cn.js';

interface DiffNavigatorProps {
  hunks: readonly DiffHunk[];
  activeIdx: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (idx: number) => void;
}

export function DiffNavigator({
  hunks,
  activeIdx,
  onPrev,
  onNext,
  onJump
}: DiffNavigatorProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (hunks.length <= 1) return null;

  const active = hunks[activeIdx];
  const label = active
    ? `Hunk ${activeIdx + 1}/${hunks.length} · ${active.oldStart}↦${active.newStart}`
    : `Hunk ${activeIdx + 1}/${hunks.length}`;

  return (
    <div
      className={cn(
        'sticky right-1.5 top-1.5 z-20 ml-auto flex items-center gap-0.5 self-end',
        'rounded-inner bg-surface-overlay/90 px-0.5 py-0.5 backdrop-blur-sm',
        'border border-border-subtle/40'
      )}
    >
      <NavIconButton title="Previous hunk" onClick={onPrev}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.25} />
      </NavIconButton>
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'inline-flex items-center gap-1 rounded-inner px-2 py-0.5',
            'text-meta font-mono text-text-muted',
            'transition-colors duration-150',
            'hover:bg-surface-hover hover:text-text-secondary'
          )}
          title="Jump to hunk"
        >
          <ListOrdered className="h-3 w-3" strokeWidth={2} />
          <span>{label}</span>
        </button>
        {open && (
          <div
            ref={popoverRef}
            role="listbox"
            aria-label="Jump to hunk"
            className={cn(
              'absolute right-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto',
              'scrollbar-stealth rounded-inner border border-border-subtle/60',
              'bg-surface-raised shadow-lg'
            )}
          >
            {hunks.map((h, i) => (
              <button
                key={i}
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                onClick={() => {
                  onJump(i);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-2 py-1 text-left',
                  'text-meta font-mono',
                  'transition-colors duration-150',
                  i === activeIdx
                    ? 'bg-accent-soft/40 text-accent'
                    : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
                )}
              >
                <span className="truncate">Hunk {i + 1}</span>
                <span className="shrink-0 text-text-faint">
                  -{h.oldStart} +{h.newStart}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <NavIconButton title="Next hunk" onClick={onNext}>
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.25} />
      </NavIconButton>
    </div>
  );
}

function NavIconButton({
  title,
  onClick,
  children
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'app-no-drag inline-flex h-6 w-6 items-center justify-center rounded-inner',
        'text-text-faint transition-colors duration-150',
        'hover:bg-surface-hover hover:text-text-secondary'
      )}
    >
      {children}
    </button>
  );
}
