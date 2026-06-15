/**
 * Compact filter field for the dock file tree.
 */

import { Search, X } from 'lucide-react';
import { SHELL_ACTION_ICON_STROKE, SHELL_COMPACT_ICON_CLASS } from '../../lib/shellIcons.js';
import { cn } from '../../lib/cn.js';

export interface DockFileTreeFilterProps {
  value: string;
  onChange: (value: string) => void;
}

export function DockFileTreeFilter({ value, onChange }: DockFileTreeFilterProps) {
  return (
    <div className="vx-dock-file-tree-filter relative shrink-0 border-b border-border-subtle/20 px-1.5 pb-2 pt-1">
      <Search
        className={cn(SHELL_COMPACT_ICON_CLASS, 'pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-text-faint')}
        strokeWidth={SHELL_ACTION_ICON_STROKE}
        aria-hidden
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter files…"
        aria-label="Filter files"
        autoComplete="off"
        spellCheck={false}
        className="vx-input vx-dock-file-tree-filter__input w-full py-1 pl-8 pr-7 font-mono text-row"
      />
      {value ? (
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-faint hover:bg-chrome-hover-soft"
          aria-label="Clear filter"
          onClick={() => onChange('')}
        >
          <X className={SHELL_COMPACT_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        </button>
      ) : null}
    </div>
  );
}
