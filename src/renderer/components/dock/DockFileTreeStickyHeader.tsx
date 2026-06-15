/**
 * Sticky parent-folder chip shown while scrolling nested tree content.
 */

import { FileIconForPath } from '../../lib/fileIconForPath.js';
import { DOCK_TREE_INDENT_PX, type FlatTreeRow } from './dockFileTreeModel.js';
import { cn } from '../../lib/cn.js';

export interface DockFileTreeStickyHeaderProps {
  row: FlatTreeRow;
  onToggle: (path: string) => void;
}

export function DockFileTreeStickyHeader({ row, onToggle }: DockFileTreeStickyHeaderProps) {
  const indent = 8 + row.depth * DOCK_TREE_INDENT_PX;

  return (
    <button
      type="button"
      className={cn(
        'vx-dock-file-tree-sticky-header flex w-full min-w-0 items-center gap-1 border-b border-border-subtle/30',
        'bg-surface-overlay/95 py-1 pr-2 text-left font-mono text-row text-text-secondary backdrop-blur-sm',
        'hover:bg-chrome-hover-soft hover:text-text-primary'
      )}
      style={{ paddingLeft: `${indent}px` }}
      aria-label={`${row.name} folder`}
      onClick={() => onToggle(row.path)}
    >
      <FileIconForPath filePath={row.path} isDir isExpanded />
      <span className="min-w-0 flex-1 truncate">{row.name}</span>
    </button>
  );
}
