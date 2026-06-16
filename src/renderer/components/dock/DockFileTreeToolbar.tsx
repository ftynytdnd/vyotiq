/**
 * Compact explorer actions above the dock file tree filter.
 */

import { FilePlus, FolderPlus, FoldVertical, RefreshCw, Trash2, UnfoldVertical } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_COMPACT_ICON_CLASS } from '../../lib/shellIcons.js';

export interface DockFileTreeToolbarProps {
  onNewFile: () => void;
  onNewFolder: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRefresh: () => void;
  onDeleteSelection?: () => void;
  selectionCount?: number;
  disabled?: boolean;
}

function toolbarButtonClassName(): string {
  return cn(
    'vx-dock-file-tree-toolbar__btn rounded p-1 text-text-faint',
    'hover:bg-chrome-hover-soft hover:text-text-secondary',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40',
    'disabled:pointer-events-none disabled:opacity-40'
  );
}

export function DockFileTreeToolbar({
  onNewFile,
  onNewFolder,
  onExpandAll,
  onCollapseAll,
  onRefresh,
  onDeleteSelection,
  selectionCount = 0,
  disabled = false
}: DockFileTreeToolbarProps) {
  const hasSelection = selectionCount > 0;

  return (
    <div
      className="vx-dock-file-tree-toolbar flex shrink-0 items-center gap-0.5 px-1.5 pb-1 pt-0"
      role="toolbar"
      aria-label="File explorer actions"
    >
      <button
        type="button"
        className={toolbarButtonClassName()}
        aria-label="New file"
        title="New file"
        disabled={disabled}
        onClick={onNewFile}
      >
        <FilePlus className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
      <button
        type="button"
        className={toolbarButtonClassName()}
        aria-label="New folder"
        title="New folder"
        disabled={disabled}
        onClick={onNewFolder}
      >
        <FolderPlus className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
      <button
        type="button"
        className={toolbarButtonClassName()}
        aria-label="Expand all folders"
        title="Expand all"
        disabled={disabled}
        onClick={onExpandAll}
      >
        <UnfoldVertical className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
      <button
        type="button"
        className={toolbarButtonClassName()}
        aria-label="Collapse all folders"
        title="Collapse all"
        disabled={disabled}
        onClick={onCollapseAll}
      >
        <FoldVertical className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
      <button
        type="button"
        className={toolbarButtonClassName()}
        aria-label="Refresh file tree"
        title="Refresh"
        disabled={disabled}
        onClick={onRefresh}
      >
        <RefreshCw className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
      </button>
      {hasSelection ? (
        <>
          <span className="vx-dock-file-tree-toolbar__selection ml-auto truncate font-mono text-[10px] text-text-faint">
            {selectionCount} selected
          </span>
          <button
            type="button"
            className={cn(toolbarButtonClassName(), 'text-danger hover:text-danger')}
            aria-label={`Delete ${selectionCount} selected items`}
            title="Delete selected"
            disabled={disabled}
            onClick={onDeleteSelection}
          >
            <Trash2 className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          </button>
        </>
      ) : null}
    </div>
  );
}
