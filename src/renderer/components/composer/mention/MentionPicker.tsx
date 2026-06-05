/**
 * Full keyboard-nav typeahead for `@` mentions — workspace files,
 * from-computer ingest, and disabled future source stubs.
 */

import { useEffect, useRef } from 'react';
import { File, HardDrive, Sparkles, BookOpen, Globe } from 'lucide-react';
import { appPopoverPanelClassName, chromeNoMatchesClassName } from '../../ui/SurfaceShell.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS
} from '../../../lib/shellIcons.js';
import { Eyebrow } from '../../ui/Eyebrow.js';
import type { MentionPickerRow, MentionPickerRowKind } from './useMentionPicker.js';

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

function rowIcon(kind: MentionPickerRowKind) {
  switch (kind) {
    case 'workspace-file':
      return File;
    case 'from-computer':
      return HardDrive;
    case 'stub-symbol':
      return Sparkles;
    case 'stub-doc':
      return BookOpen;
    case 'stub-web':
      return Globe;
    default:
      return File;
  }
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-mention-row-index="${activeIndex}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  if (!open) return null;

  return (
    <div
      className={cn(appPopoverPanelClassName, 'w-80 p-1.5 shadow-lg')}
      role="listbox"
      aria-label="Mention files"
      onMouseDown={(e) => e.preventDefault()}
    >
      <Eyebrow className="px-2 pb-1.5">
        Mention{' '}
        {query ? (
          <span className="font-mono normal-case text-text-muted">@{query}</span>
        ) : (
          '@…'
        )}
      </Eyebrow>
      <div ref={listRef} className="max-h-72 overflow-y-auto" aria-live="polite">
        {loading && (
          <div className={chromeNoMatchesClassName}>Loading workspace…</div>
        )}
        {!loading && rows.length === 0 && (
          <div className={chromeNoMatchesClassName}>No matches.</div>
        )}
        {!loading &&
          rows.map((row, index) => {
            const Icon = rowIcon(row.kind);
            const isActive = index === activeIndex;
            return (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={isActive}
                data-mention-row-index={index}
                disabled={row.disabled}
                onMouseEnter={() => onActiveIndexChange(index)}
                onClick={() => {
                  if (row.disabled) return;
                  onPick(row);
                  onClose();
                }}
                className={cn(
                  'vx-dropdown-item flex w-full items-center gap-2',
                  row.disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                  isActive && !row.disabled && 'bg-surface-raised'
                )}
              >
                <Icon
                  className={cn(SHELL_ROW_ICON_CLASS, 'text-text-faint shrink-0')}
                  strokeWidth={SHELL_ACTION_ICON_STROKE}
                />
                <span className="truncate font-mono text-left">{row.label}</span>
                {row.hint ? (
                  <span className="ml-auto shrink-0 text-meta text-text-faint">{row.hint}</span>
                ) : null}
              </button>
            );
          })}
      </div>
    </div>
  );
}
