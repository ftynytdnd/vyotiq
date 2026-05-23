/**
 * WAI-ARIA vertical tablist keyboard handler for the left dock.
 * ArrowUp/ArrowDown cycle selection; Home/End jump to ends.
 */

import type { KeyboardEvent } from 'react';

interface DockVerticalTablistKeyDownOptions {
  e: KeyboardEvent;
  ids: readonly string[];
  activeId: string | null;
  onActivate: (id: string) => void;
  focusTarget: (id: string) => HTMLElement | null | undefined;
}

export function handleDockVerticalTablistKeyDown({
  e,
  ids,
  activeId,
  onActivate,
  focusTarget
}: DockVerticalTablistKeyDownOptions): void {
  if (ids.length === 0) return;

  let nextIdx: number | null = null;
  const idx = activeId ? ids.indexOf(activeId) : -1;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    nextIdx = idx === -1 ? 0 : (idx + 1) % ids.length;
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    nextIdx = idx === -1 ? ids.length - 1 : (idx - 1 + ids.length) % ids.length;
  } else if (e.key === 'Home') {
    e.preventDefault();
    nextIdx = 0;
  } else if (e.key === 'End') {
    e.preventDefault();
    nextIdx = ids.length - 1;
  } else {
    return;
  }

  const nextId = ids[nextIdx]!;
  if (nextId === activeId) {
    focusTarget(nextId)?.focus();
    return;
  }
  onActivate(nextId);
  queueMicrotask(() => focusTarget(nextId)?.focus());
}
