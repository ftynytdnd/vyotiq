/**
 * Dock section label — add workspace only (search/new chat live in titlebar).
 */

import { FolderPlus } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_COMPACT_ICON_CLASS } from '../../lib/shellIcons.js';
import { chromeToolbarButtonClassName } from '../ui/SurfaceShell.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

export function DockNavigatorHeader() {
  const addWorkspace = useWorkspaceStore((s) => s.add);
  const workspaceCount = useWorkspaceStore((s) => s.list.length);

  return (
    <header className="vx-dock-nav-header flex shrink-0 items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-baseline gap-1.5 text-meta font-medium text-text-faint">
        Workspaces
        {workspaceCount > 0 ? (
          <span aria-hidden className="font-mono tabular-nums text-text-faint/70">
            {workspaceCount}
          </span>
        ) : null}
      </h2>
      <button
        type="button"
        className={cn(chromeToolbarButtonClassName(), 'h-6 w-6 shrink-0 px-0')}
        title="Add workspace"
        aria-label="Add workspace"
        onClick={() => void addWorkspace()}
      >
        <FolderPlus className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
    </header>
  );
}
