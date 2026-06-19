/**
 * Tracks model picker panel width for stacked vs split layout.
 * Uses ResizeObserver with proper teardown for long-lived desktop sessions.
 */

import { useEffect, useState, type RefObject } from 'react';
import { MODEL_PICKER_SPLIT_MIN_PX } from './modelPickerLayout.js';

export type ModelPickerLayoutMode = 'stacked' | 'split';

export interface ModelPickerLayoutState {
  mode: ModelPickerLayoutMode;
  /** User-expanded details rail when stacked (split mode is always expanded). */
  detailsOpen: boolean;
  setDetailsOpen: (open: boolean) => void;
  toggleDetails: () => void;
}

function readInlineWidth(entry: ResizeObserverEntry): number {
  const box = entry.contentBoxSize;
  if (box && box.length > 0) return box[0]!.inlineSize;
  return entry.contentRect.width;
}

export function useModelPickerLayout(
  panelRef: RefObject<HTMLElement | null>
): ModelPickerLayoutState {
  const [mode, setMode] = useState<ModelPickerLayoutMode | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const applyWidth = (width: number) => {
      if (width <= 0) return;
      const nextMode: ModelPickerLayoutMode =
        width < MODEL_PICKER_SPLIT_MIN_PX ? 'stacked' : 'split';
      setMode(nextMode);
    };

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      applyWidth(readInlineWidth(entry));
    });

    ro.observe(el);
    applyWidth(el.getBoundingClientRect().width);

    return () => ro.disconnect();
  }, [panelRef]);

  useEffect(() => {
    if (mode === 'split') setDetailsOpen(true);
  }, [mode]);

  const resolvedMode: ModelPickerLayoutMode = mode ?? 'split';

  return {
    mode: resolvedMode,
    detailsOpen: resolvedMode === 'split' ? true : detailsOpen,
    setDetailsOpen,
    toggleDetails: () => setDetailsOpen((open) => !open)
  };
}
