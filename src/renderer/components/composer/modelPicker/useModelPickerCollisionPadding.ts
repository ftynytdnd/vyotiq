/**
 * Viewport insets for the composer model picker — accounts for dock strip,
 * expanded flyout, and title bar so the panel stays in the chat column.
 */

import { useMemo } from 'react';
import { DOCK_STRIP_WIDTH } from '@shared/dock/dockWidth.js';
import { useUiStore } from '../../../store/useUiStore.js';
import { readTitlebarInsetPx, type PopoverCollisionPadding } from '../../ui/popoverPosition.js';

const EDGE = 12;

export function useModelPickerCollisionPadding(): PopoverCollisionPadding {
  const dockExpanded = useUiStore((s) => s.dockExpanded);
  const dockWidth = useUiStore((s) => s.dockWidth);

  return useMemo(() => {
    const leftInset = DOCK_STRIP_WIDTH + (dockExpanded ? dockWidth : 0) + EDGE;
    const rightInset = DOCK_STRIP_WIDTH + EDGE;
    return {
      top: readTitlebarInsetPx() + EDGE,
      bottom: EDGE + 8,
      left: leftInset,
      right: rightInset
    };
  }, [dockExpanded, dockWidth]);
}
