/**
 * Compact filter field for the dock file tree.
 */

import { Search, X } from 'lucide-react';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';

export interface DockFileTreeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function DockFileTreeFilter({ value, onChange, className }: DockFileTreeFilterProps & { className?: string }) {
  return (
    <div className={cn('vx-dock-file-tree-filter flex w-full min-w-0 items-center gap-1', className)}>
      <Search
        className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-faint')}
        strokeWidth={SHELL_ROW_ICON_STROKE}
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter…"
        aria-label="Filter files"
        autoComplete="off"
        spellCheck={false}
        className="vx-input vx-dock-file-tree-filter__input min-w-0 flex-1 py-0.5 pl-0 font-mono text-row"
      />
      {value ? (
        <button
          type="button"
          className="vx-btn vx-btn-quiet h-6 w-6 shrink-0 px-0 text-text-faint"
          aria-label="Clear filter"
          onClick={() => onChange('')}
        >
          <X className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
      ) : null}
    </div>
  );
}
