/**
 * Single flat row in the virtualized dock file tree.
 */

import { memo, useEffect, useRef, type CSSProperties, type MouseEvent } from 'react';
import { Loader2 } from 'lucide-react';
import {
  DOCK_TREE_INDENT_PX,
  type FlatTreeRow
} from './dockFileTreeModel.js';
import { FileIconForPath } from '../../lib/fileIconForPath.js';
import {
  gitStatusAriaLabel,
  gitStatusBadgeCn,
  gitStatusNameClass
} from '../../lib/dockGitTreeStyle.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import type { GitPathStatus } from '@shared/types/ipc.js';

export interface DockFileTreeRowProps {
  row: FlatTreeRow;
  activePath: string | null;
  contextTargetPath?: string | null;
  gitStatus?: GitPathStatus | null;
  focused?: boolean;
  selected?: boolean;
  renaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onRowPointerDown?: (
    path: string,
    isDir: boolean,
    event: MouseEvent<HTMLButtonElement>
  ) => void;
  onContextMenu: (path: string, isDir: boolean, event: MouseEvent<HTMLButtonElement>) => void;
  setRowRef?: (path: string, el: HTMLButtonElement | null) => void;
  style?: CSSProperties;
}

export const DockFileTreeRow = memo(function DockFileTreeRow({
  row,
  activePath,
  contextTargetPath = null,
  gitStatus = null,
  focused = false,
  selected = false,
  renaming = false,
  renameValue = '',
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onToggle,
  onOpenFile,
  onRowPointerDown,
  onContextMenu,
  setRowRef,
  style
}: DockFileTreeRowProps) {
  const { path, name, depth, isDir, isExpanded, isLoading } = row;
  const isActive = !isDir && activePath === path;
  const isContextTarget = contextTargetPath === path && !isActive;
  const indent = 8 + depth * DOCK_TREE_INDENT_PX;
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  if (renaming) {
    return (
      <div
        className="vx-dock-file-tree-row flex w-full min-w-0 items-center gap-1 py-1 pr-2"
        style={{ ...style, paddingLeft: `${indent}px` }}
      >
        <span className="inline-block w-3.5 shrink-0" aria-hidden />
        <input
          ref={renameInputRef}
          type="text"
          value={renameValue}
          onChange={(e) => onRenameChange?.(e.target.value)}
          className="vx-input min-w-0 flex-1 py-0.5 font-mono text-row"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onRenameCommit?.();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onRenameCancel?.();
            }
          }}
          onBlur={() => onRenameCancel?.()}
        />
      </div>
    );
  }

  return (
    <button
      ref={(el) => setRowRef?.(path, el)}
      type="button"
      role="treeitem"
      aria-expanded={isDir ? isExpanded : undefined}
      aria-label={isDir ? `${name} folder` : name}
      aria-selected={focused || isActive || selected}
      tabIndex={focused ? 0 : -1}
        className={cn(
        'vx-dock-file-tree-row group relative flex w-full min-w-0 items-center gap-1 text-left font-mono text-row',
        isDir ? 'text-text-secondary' : 'text-text-primary',
        isActive && 'vx-dock-file-tree-row-active text-text-primary',
        selected && !isActive && 'vx-dock-file-tree-row-selected text-text-primary',
        isContextTarget && 'ring-1 ring-inset ring-border-strong/40',
        focused && !isActive && !isContextTarget && 'text-text-primary',
        !isActive && gitStatusNameClass(gitStatus)
      )}
      style={{
        ...style,
        paddingLeft: `${indent}px`
      }}
      onClick={(event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          onRowPointerDown?.(path, isDir, event);
          return;
        }
        if (isDir) onToggle(path);
        else void onOpenFile(path);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(path, isDir, e);
      }}
    >
      {depth > 0 ? (
        <span className="vx-dock-file-tree-indent-guides" aria-hidden>
          {Array.from({ length: depth }, (_, level) => (
            <span
              key={level}
              className="vx-dock-file-tree-indent-guide"
              style={{ left: `${8 + level * DOCK_TREE_INDENT_PX + DOCK_TREE_INDENT_PX / 2}px` }}
            />
          ))}
        </span>
      ) : null}
      {isDir && isLoading ? (
        <Loader2
          className={cn(SHELL_ROW_ICON_CLASS, 'animate-spin text-text-faint')}
          strokeWidth={SHELL_ACTION_ICON_STROKE}
        />
      ) : (
        <FileIconForPath filePath={path} isDir={isDir} isExpanded={isDir && isExpanded} />
      )}
      <span className="min-w-0 flex-1 truncate pr-1">{name}</span>
      {gitStatus ? (
        <span
          className={cn(gitStatusBadgeCn(gitStatus), 'ml-auto shrink-0')}
          aria-label={gitStatusAriaLabel(gitStatus)}
        >
          {gitStatus}
        </span>
      ) : null}
    </button>
  );
});
