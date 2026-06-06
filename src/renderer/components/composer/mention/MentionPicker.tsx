/**
 * Full keyboard-nav typeahead for `@` mentions — workspace files.
 */

import { useEffect, useRef } from 'react';
import { File } from 'lucide-react';
import { appPopoverPanelClassName, chromeNoMatchesClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../../lib/shellIcons.js';
import { Eyebrow } from '../../ui/Eyebrow.js';
import type { MentionPickerRow } from './useMentionPicker.js';

export interface MentionPickerProps {
  open: boolean;
  query: string;
  rows: MentionPickerRow[];
  loading: boolean;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (row: MentionPickerRow) => void;
  onClose: () => void;
}

export function MentionPicker({
  open,
  query,
  rows,
  loading,
  activeIndex,
  onActiveIndexChange,
  onPick,
  onClose
}: MentionPickerProps) {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  if (!open) return null;

  return (
    <div
      className={cn(appPopoverPanelClassName, 'vx-mention-picker max-h-64 min-w-[16rem] overflow-y-auto p-1')}
      role="listbox"
      aria-label="Mention files"
    >
      <Eyebrow className="px-2 pb-1 pt-0.5">Workspace files</Eyebrow>
      {loading && rows.length === 0 ? (
        <div className="px-2 py-1.5 text-meta text-text-faint">Loading…</div>
      ) : rows.length === 0 ? (
        <div className={chromeNoMatchesClassName}>No files match</div>
      ) : (
        <ul ref={listRef} className="flex flex-col gap-0.5">
          {rows.map((row, i) => {
            const Icon = File;
            const active = i === activeIndex;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={row.disabled}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-row',
                    active ? 'bg-chrome-hover text-text-primary' : 'text-text-secondary',
                    row.disabled && 'cursor-not-allowed opacity-50'
                  )}
                  onMouseEnter={() => onActiveIndexChange(i)}
                  onClick={() => {
                    if (!row.disabled) onPick(row);
                    onClose();
                  }}
                >
                  <Icon
                    className={SHELL_ROW_ICON_CLASS}
                    strokeWidth={SHELL_ACTION_ICON_STROKE}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate">{row.label}</span>
                  {row.hint ? (
                    <span className="ml-auto shrink-0 text-meta text-text-faint">{row.hint}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {query.trim().length > 0 && (
        <div className="border-t border-border-subtle/30 px-2 py-1 text-meta text-text-faint">
          Filter: {query}
        </div>
      )}
    </div>
  );
}
