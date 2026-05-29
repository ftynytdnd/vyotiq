/**
 * Focus trap + restore for the expanded dock flyout (dialog-like overlay).
 */

import { useEffect, useRef, type RefObject } from 'react';
import { bindFocusTrap, focusFirstFocusable } from '../../lib/focusTrap.js';

export function useDockFlyoutFocus(
  dockExpanded: boolean,
  flyoutRef: RefObject<HTMLElement | null>,
  onDismiss: () => void
): void {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!dockExpanded) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const root = flyoutRef.current;
      if (root) focusFirstFocusable(root);
    });
    const unbindTrap = bindFocusTrap({
      getRoot: () => flyoutRef.current,
      onEscape: onDismiss
    });

    return () => {
      cancelAnimationFrame(raf);
      unbindTrap();
      const prev = previouslyFocusedRef.current;
      if (prev && document.body.contains(prev)) prev.focus();
    };
  }, [dockExpanded, flyoutRef, onDismiss]);
}
