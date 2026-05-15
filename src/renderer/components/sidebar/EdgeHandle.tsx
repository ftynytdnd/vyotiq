/**
 * EdgeHandle — floating chevron-right pill pinned to the very left edge of
 * the window when the sidebar is collapsed. Provides a visible, click-target
 * affordance to re-open the sidebar without relying on the Ctrl+B shortcut.
 *
 * Rendered as a sibling of the sidebar wrapper (not inside it) so it stays
 * visible while the wrapper is at width 0.
 */

import { ChevronRight } from 'lucide-react';
import { useUiStore } from '../../store/useUiStore.js';
import { cn } from '../../lib/cn.js';

export function EdgeHandle() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  if (sidebarOpen) return null;

  return (
    <button
      type="button"
      aria-label="Show sidebar"
      title="Show sidebar (Ctrl+B)"
      onClick={() => setSidebarOpen(true)}
      className={cn(
        'app-no-drag absolute left-0 top-1/2 z-40 flex h-10 w-5 -translate-y-1/2 items-center justify-center',
        'rounded-r-inner border border-l-0 border-border-subtle/30 bg-surface-overlay text-text-faint',
        'opacity-70 transition-all duration-150',
        'hover:w-6 hover:bg-surface-hover hover:text-text-primary hover:opacity-100'
      )}
    >
      <ChevronRight className="h-3 w-3" strokeWidth={2.25} />
    </button>
  );
}
