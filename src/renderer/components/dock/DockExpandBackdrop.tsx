/**
 * Semi-transparent backdrop behind an expanded floating dock — click to collapse.
 */

import { useUiStore } from '../../store/useUiStore.js';
import { cn } from '../../lib/cn.js';
import { dismissDockFlyout, DOCK_STRIP_WIDTH } from './dockShared.js';

export function DockExpandBackdrop() {
  const dockExpanded = useUiStore((s) => s.dockExpanded);

  if (!dockExpanded) return null;

  return (
    <button
      type="button"
      aria-label="Close navigation"
      style={{ left: DOCK_STRIP_WIDTH }}
      className={cn(
        'fixed bottom-0 right-0 z-(--z-dock-backdrop) border-0 p-0',
        'top-[var(--titlebar-h)]',
        'bg-surface-base/55',
        'cursor-default transition-opacity duration-200'
      )}
      onClick={dismissDockFlyout}
    />
  );
}
