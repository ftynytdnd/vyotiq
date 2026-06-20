/**
 * Full keyboard-nav typeahead for `@` mentions — files, symbols, conversations.
 */

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import {
  AtSign,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  Hash,
  MessageSquare
} from 'lucide-react';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { appPopoverPanelClassName, chromeNoMatchesClassName } from '../../ui/SurfaceShell.js';
import { ModelPickerSectionHeader } from '../modelPicker/ModelPickerSectionHeader.js';
import { cn } from '../../../lib/cn.js';
import {
  SHELL_ACTION_ICON_STROKE,
  SHELL_ROW_ICON_CLASS,
  SHELL_ROW_ICON_STROKE
} from '../../../lib/shellIcons.js';
import type {
  MentionPickerGroup,
  MentionPickerRow,
  MentionPickerRowKind
} from './useMentionPicker.js';
import { scrollMentionRowIntoView } from './scrollMentionRowIntoView.js';

export interface MentionPickerProps {
  open: boolean;
  query: string;
  groups: MentionPickerGroup[];
  /** All visible rows in display order (folders + pickable rows). */
  rows: MentionPickerRow[];
  activeRow: MentionPickerRow | null;
  loading: boolean;
  treeTruncated?: boolean;
  activeIndex: number;
  scrollFromKeyboardRef?: RefObject<boolean>;
  onActiveIndexChange: (index: number) => void;
  onPick: (row: MentionPickerRow) => void;
  onToggleFolder: (folderPath: string) => void;
  onClose: () => void;
}

const SELECTABLE_KIND_ICON: Partial<Record<MentionPickerRowKind, typeof File>> = {
  'workspace-file': File,
  symbol: Hash,
  conversation: MessageSquare
};

const MENTION_TREE_INDENT_PX = 12;

function rowPrimaryLabel(row: MentionPickerRow): string {
  if (row.kind === 'workspace-file') return basenameFromPath(row.label);
  if (row.kind === 'workspace-folder') return row.label;
  return row.label;
}

function isRowActive(row: MentionPickerRow, activeRow: MentionPickerRow | null): boolean {
  return activeRow?.id === row.id;
}

export function MentionPicker({
  open,
  query,
  groups,
  rows,
  activeRow,
  loading,
  treeTruncated = false,
  activeIndex,
  scrollFromKeyboardRef,
  onActiveIndexChange,
  onPick,
  onToggleFolder,
  onClose
}: MentionPickerProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!open || !activeRow) return;
    if (scrollFromKeyboardRef && !scrollFromKeyboardRef.current) return;
    if (scrollFromKeyboardRef) scrollFromKeyboardRef.current = false;
    const rowEl = listRef.current?.querySelector(
      `[data-mention-id="${activeRow.id}"]`
    ) as HTMLElement | undefined;
    scrollMentionRowIntoView(listRef.current, rowEl ?? null);
  }, [open, activeRow?.id, activeIndex, scrollFromKeyboardRef]);

  if (!open) return null;

  const hasVisibleRows = groups.some((g) => g.rows.length > 0 || g.emptyHint);
  const showGlobalEmpty = !loading && !hasVisibleRows;

  return (
    <div
      className={cn(
        appPopoverPanelClassName,
        'vx-mention-picker flex h-full max-h-full min-h-0 w-full min-w-0 flex-col'
      )}
      role="presentation"
    >
      <div className="vx-mention-picker-head shrink-0 flex items-center gap-2 border-b border-border-subtle/30 px-2 py-1.5">
        <AtSign
          className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-faint')}
          strokeWidth={SHELL_ROW_ICON_STROKE}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-row text-text-primary">Mention</div>
          <div className="truncate text-meta text-text-faint">
            {trimmedQuery.length > 0 ? `Filtering · ${trimmedQuery}` : 'Workspace files, symbols, chats'}
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        className="vx-mention-picker-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5 py-0.5"
        role="listbox"
        aria-label="Mention picker"
        aria-activedescendant={activeRow ? `mention-row-${activeRow.id}` : undefined}
        onWheel={(e) => e.stopPropagation()}
      >
        {showGlobalEmpty ? (
          <div className={cn(chromeNoMatchesClassName, 'py-3 text-center')}>No matches</div>
        ) : (
          groups.map((group) => (
            <MentionPickerSection
              key={group.kind}
              group={group}
              rows={rows}
              activeRow={activeRow}
              onActiveIndexChange={onActiveIndexChange}
              onPick={onPick}
              onToggleFolder={onToggleFolder}
              onClose={onClose}
            />
          ))
        )}
        {treeTruncated && !showGlobalEmpty ? (
          <div className="border-t border-border-subtle/20 px-2 py-1 text-meta text-text-faint">
            Results truncated — narrow your filter
          </div>
        ) : null}
      </div>

      <div className="vx-mention-picker-foot shrink-0 border-t border-border-subtle/30 px-2 py-1">
        <div className="vx-model-picker-hints text-meta text-text-faint" aria-hidden>
          <span className="vx-model-picker-hints--nav">
            <HintKbd>↑</HintKbd>
            <HintKbd>↓</HintKbd> navigate
          </span>
          <span>
            <HintKbd>Enter</HintKbd> select · folder expand
          </span>
          <span className="vx-model-picker-hints--compact">
            <HintKbd>Esc</HintKbd> dismiss
          </span>
        </div>
      </div>
    </div>
  );
}

function MentionPickerSection({
  group,
  activeRow,
  rows,
  onActiveIndexChange,
  onPick,
  onToggleFolder,
  onClose
}: {
  group: MentionPickerGroup;
  activeRow: MentionPickerRow | null;
  rows: MentionPickerRow[];
  onActiveIndexChange: (index: number) => void;
  onPick: (row: MentionPickerRow) => void;
  onToggleFolder: (folderPath: string) => void;
  onClose: () => void;
}) {
  const selectableCount = group.rows.filter(
    (row) => row.kind !== 'workspace-folder' && !row.disabled
  ).length;

  return (
    <section className="vx-mention-picker-section" aria-label={group.label}>
      <ModelPickerSectionHeader
        label={group.label}
        variant="category"
        count={selectableCount > 0 ? selectableCount : undefined}
      />
      {group.rows.length > 0 ? (
        <ul className="flex flex-col gap-0.5 pb-0.5">
          {group.rows.map((row) => {
            const navIndex = rows.findIndex((r) => r.id === row.id);
            if (row.kind === 'workspace-folder') {
              return (
                <li key={row.id}>
                  <FolderRow
                    row={row}
                    active={isRowActive(row, activeRow)}
                    navIndex={navIndex}
                    onHover={onActiveIndexChange}
                    onToggle={() => row.path && onToggleFolder(row.path)}
                  />
                </li>
              );
            }
            const Icon = SELECTABLE_KIND_ICON[row.kind] ?? File;
            return (
              <li key={row.id}>
                <MentionPickerRowButton
                  row={row}
                  icon={
                    <Icon
                      className={SHELL_ROW_ICON_CLASS}
                      strokeWidth={SHELL_ACTION_ICON_STROKE}
                      aria-hidden
                    />
                  }
                  navIndex={navIndex}
                  active={isRowActive(row, activeRow)}
                  onActiveIndexChange={onActiveIndexChange}
                  onPick={onPick}
                  onClose={onClose}
                />
              </li>
            );
          })}
        </ul>
      ) : group.emptyHint ? (
        <div className="vx-mention-picker-empty px-2 pb-1.5 pt-0.5 text-meta text-text-faint">
          {group.emptyHint}
        </div>
      ) : null}
    </section>
  );
}

function FolderRow({
  row,
  active,
  navIndex,
  onHover,
  onToggle
}: {
  row: MentionPickerRow;
  active: boolean;
  navIndex: number;
  onHover: (index: number) => void;
  onToggle: () => void;
}) {
  const depth = row.depth ?? 0;
  const indent = 8 + depth * MENTION_TREE_INDENT_PX;
  const Chevron = row.isExpanded ? ChevronDown : ChevronRight;

  return (
    <button
      type="button"
      role="option"
      id={active ? `mention-row-${row.id}` : undefined}
      aria-selected={active}
      data-mention-id={row.id}
      className={cn(
        'vx-mention-picker-folder vx-dropdown-item flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left',
        active && 'bg-dock-selection'
      )}
      style={{ paddingLeft: `${indent}px` }}
      onMouseEnter={() => {
        if (navIndex >= 0) onHover(navIndex);
      }}
      onClick={onToggle}
    >
      <Chevron
        className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-faint')}
        strokeWidth={SHELL_ACTION_ICON_STROKE}
        aria-hidden
      />
      <Folder
        className={cn(SHELL_ROW_ICON_CLASS, 'shrink-0 text-text-faint')}
        strokeWidth={SHELL_ACTION_ICON_STROKE}
        aria-hidden
      />
      <span className="min-w-0 truncate font-mono text-row text-text-secondary">{row.label}</span>
    </button>
  );
}

function MentionPickerRowButton({
  row,
  icon,
  navIndex,
  active,
  onActiveIndexChange,
  onPick,
  onClose
}: {
  row: MentionPickerRow;
  icon: ReactNode;
  navIndex: number;
  active: boolean;
  onActiveIndexChange: (index: number) => void;
  onPick: (row: MentionPickerRow) => void;
  onClose: () => void;
}) {
  const mono = row.kind === 'workspace-file' || row.kind === 'symbol';
  const depth = row.depth ?? 0;
  const indent = 8 + depth * MENTION_TREE_INDENT_PX + (row.kind === 'workspace-file' ? 14 : 0);

  return (
    <button
      type="button"
      role="option"
      id={active ? `mention-row-${row.id}` : undefined}
      aria-selected={active}
      aria-disabled={row.disabled || undefined}
      data-mention-id={row.id}
      disabled={row.disabled || navIndex < 0}
      className={cn(
        'vx-mention-picker-row vx-dropdown-item flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left',
        active && 'bg-dock-selection',
        row.disabled && 'cursor-not-allowed opacity-50'
      )}
      style={{ paddingLeft: `${indent}px` }}
      onMouseEnter={() => {
        if (navIndex >= 0) onActiveIndexChange(navIndex);
      }}
      onClick={() => {
        if (row.disabled || navIndex < 0) return;
        onPick(row);
        onClose();
      }}
    >
      <span className="shrink-0 text-text-faint">{icon}</span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-row text-text-secondary',
            mono && 'font-mono',
            active && 'text-text-primary'
          )}
        >
          {rowPrimaryLabel(row)}
        </span>
        {row.subtitle && row.kind !== 'workspace-file' ? (
          <span className="block truncate font-mono text-meta text-text-faint">{row.subtitle}</span>
        ) : null}
      </span>
      {row.disabled ? (
        <span className="shrink-0 text-meta text-text-faint">Added</span>
      ) : row.hint ? (
        <span className="shrink-0 font-mono text-meta text-text-faint">{row.hint}</span>
      ) : null}
    </button>
  );
}

function HintKbd({ children }: { children: ReactNode }) {
  return <kbd className="vx-model-picker-hint-kbd">{children}</kbd>;
}
