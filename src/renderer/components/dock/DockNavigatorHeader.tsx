/**
 * Dock section label — add local folder or GitHub repo.
 */

import { FolderGit2, FolderPlus } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_COMPACT_ICON_CLASS } from '../../lib/shellIcons.js';
import { chromeToolbarButtonClassName } from '../ui/SurfaceShell.js';
import { openWorkspaceLauncher } from '../../store/useWorkspaceLauncherStore.js';
import { useUiStore } from '../../store/useUiStore.js';

function openInlineWorkspaceLauncher(source: 'local' | 'github' | 'all'): void {
  useUiStore.getState().setDockExpanded(true);
  openWorkspaceLauncher(source, 'inline');
}
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';

export function DockNavigatorHeader() {
  const workspaceCount = useWorkspaceStore((s) => s.list.length);

  return (
    <header className="vx-dock-nav-header flex shrink-0 items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-baseline gap-1.5 text-row font-medium text-text-muted">
        Workspaces
        {workspaceCount > 0 ? (
          <span aria-hidden className="font-mono tabular-nums text-text-faint/70">
            {workspaceCount}
          </span>
        ) : null}
      </h2>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className={cn(chromeToolbarButtonClassName(), 'h-6 w-6 shrink-0 px-0')}
          title="Open from GitHub"
          aria-label="Open from GitHub"
          onClick={() => openInlineWorkspaceLauncher('github')}
        >
          <FolderGit2 className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
        <button
          type="button"
          className={cn(chromeToolbarButtonClassName(), 'h-6 w-6 shrink-0 px-0')}
          title="Add workspace"
          aria-label="Add workspace"
          onClick={() => openInlineWorkspaceLauncher('local')}
        >
          <FolderPlus className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
      </div>
    </header>
  );
}
