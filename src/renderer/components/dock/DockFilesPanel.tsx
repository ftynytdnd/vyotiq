/**
 * Active-workspace file tree — flows directly below the workspace list.
 */

import { ChevronRight } from 'lucide-react';
import { DockFileTree } from './DockFileTree.js';
import { cn } from '../../lib/cn.js';
import { SHELL_COMPACT_ICON_CLASS, SHELL_COMPACT_ICON_STROKE } from '../../lib/shellIcons.js';

export interface DockFilesPanelProps {
  workspaceId: string;
  workspaceLabel?: string;
  expanded: boolean;
  onToggle: () => void;
}

export function DockFilesPanel({
  workspaceId,
  workspaceLabel,
  expanded,
  onToggle
}: DockFilesPanelProps) {
  return (
    <section
      className={cn(
        'vx-dock-files-panel',
        expanded && 'vx-dock-files-panel--expanded flex min-h-0 flex-1 flex-col'
      )}
      aria-label="Workspace files"
    >
      <button
        type="button"
        className={cn(
          'vx-dock-files-panel-toggle flex w-full min-w-0 items-center gap-0.5 text-left text-meta',
          expanded ? 'text-text-secondary' : 'text-text-faint'
        )}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <ChevronRight
          className={cn(
            SHELL_COMPACT_ICON_CLASS,
            'shrink-0 transition-transform duration-150',
            expanded && 'rotate-90'
          )}
          strokeWidth={SHELL_COMPACT_ICON_STROKE}
          aria-hidden
        />
        <span className="shrink-0">Files</span>
        {workspaceLabel && expanded ? (
          <span className="min-w-0 truncate text-text-faint">· {workspaceLabel}</span>
        ) : null}
      </button>
      {expanded ? (
        <div className="vx-dock-files-panel-body flex min-h-0 flex-col overflow-hidden">
          <DockFileTree workspaceId={workspaceId} />
        </div>
      ) : null}
    </section>
  );
}
