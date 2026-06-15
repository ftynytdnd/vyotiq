/**
 * Single flat row in the virtualized dock file tree.
 */

import { memo, useEffect, useRef, type CSSProperties, type MouseEvent } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import {
  DOCK_TREE_INDENT_PX,
  type FlatTreeRow
} from './dockFileTreeModel.js';
import { fileIconForPath } from '../../lib/fileIconForPath.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

export interface DockFileTreeRowProps {
  row: FlatTreeRow;
  activePath: string | null;
  contextTargetPath?: string | null;
  gitStatus?: string | null;
  focused?: boolean;
  renaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameCommit?: () => void;
  onRenameCancel?: () => void;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
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
  renaming = false,
  renameValue = '',
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onToggle,
  onOpenFile,
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
      aria-selected={focused || isActive}
      tabIndex={focused ? 0 : -1}
      className={cn(
        'vx-dock-file-tree-row group flex w-full min-w-0 items-center gap-1 rounded-md py-1 pr-2 text-left font-mono text-row transition-colors hover:bg-chrome-hover-soft',
        isDir ? 'text-text-secondary' : 'text-text-primary',
        isActive && 'vx-dock-file-tree-row-active bg-accent/10 text-text-primary',
        isContextTarget && 'bg-chrome-hover-soft ring-1 ring-inset ring-border-strong/50',
        focused && !isActive && 'bg-chrome-hover-soft/60'
      )}
      style={{
        ...style,
        paddingLeft: `${indent}px`,
        backgroundImage:
          depth > 0
            ? `linear-gradient(to right, transparent ${indent - 1}px, color-mix(in oklch, var(--color-border-subtle) 35%, transparent) ${indent - 1}px, color-mix(in oklch, var(--color-border-subtle) 35%, transparent) ${indent}px, transparent ${indent}px)`
            : undefined
      }}
      onClick={() => {
        if (isDir) onToggle(path);
        else void onOpenFile(path);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(path, isDir, e);
      }}
    >
      {isDir ? (
        isLoading ? (
          <Loader2
            className={cn(SHELL_ROW_ICON_CLASS, 'animate-spin text-text-faint')}
            strokeWidth={SHELL_ACTION_ICON_STROKE}
          />
        ) : isExpanded ? (
          <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        ) : (
          <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        )
      ) : (
        <span className="inline-block w-3.5 shrink-0" aria-hidden />
      )}
      {fileIconForPath(path, isDir)}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {gitStatus ? (
        <span
          className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-text-faint"
          aria-label={`Git status ${gitStatus}`}
        >
          {gitStatus}
        </span>
      ) : null}
    </button>
  );
});
