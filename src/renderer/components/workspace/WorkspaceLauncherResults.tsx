/**
 * Grouped result rows for the workspace launcher palette.
 */

import type { ReactNode } from 'react';
import { FolderGit2, FolderOpen } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { chromeNoMatchesClassName } from '../ui/SurfaceShell.js';
import { ModelPickerSectionHeader } from '../composer/modelPicker/ModelPickerSectionHeader.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import type {
  WorkspaceLauncherGroup,
  WorkspaceLauncherRow
} from './workspaceLauncherTypes.js';

interface WorkspaceLauncherResultsProps {
  groups: WorkspaceLauncherGroup[];
  flatRows: WorkspaceLauncherRow[];
  activeIndex: number;
  selectedRepoFullName: string | null;
  reposLoading: boolean;
  onActiveIndexChange: (index: number) => void;
  onActivateRow: (row: WorkspaceLauncherRow) => void;
  connectSection: ReactNode;
  showConnectSection: boolean;
}

function flatIndexForRow(groups: WorkspaceLauncherGroup[], rowId: string): number {
  let index = 0;
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.id === rowId) return index;
      index += 1;
    }
  }
  return -1;
}

export function WorkspaceLauncherResults({
  groups,
  flatRows,
  activeIndex,
  selectedRepoFullName,
  reposLoading,
  onActiveIndexChange,
  onActivateRow,
  connectSection,
  showConnectSection
}: WorkspaceLauncherResultsProps) {
  const hasResults = flatRows.length > 0 || showConnectSection;

  return (
    <div
      id="workspace-launcher-results"
      role="listbox"
      aria-label="Workspace launcher results"
      className="vx-workspace-launcher-results scrollbar-stealth min-h-0 max-h-[min(42dvh,360px)] overflow-y-auto rounded-inner bg-surface-input/30 px-0.5 py-0.5"
    >
      {!hasResults && !reposLoading ? (
        <div className={cn(chromeNoMatchesClassName, 'py-3')}>No matches.</div>
      ) : null}
      {reposLoading && flatRows.length === 0 && !showConnectSection ? (
        <div className={cn(chromeNoMatchesClassName, 'py-3')}>Loading repositories…</div>
      ) : null}
      {groups.map((group) => (
        <div key={group.id} className="py-0.5">
          <ModelPickerSectionHeader label={group.label} variant="category" />
          {group.rows.map((row) => {
            const rowIndex = flatIndexForRow(groups, row.id);
            const active = rowIndex === activeIndex;
            return (
              <LauncherResultRow
                key={row.id}
                row={row}
                active={active}
                selected={
                  (row.kind === 'github-repo' || row.kind === 'github-recent') &&
                  selectedRepoFullName === row.repo.fullName
                }
                onMouseEnter={() => onActiveIndexChange(rowIndex)}
                onClick={() => onActivateRow(row)}
              />
            );
          })}
        </div>
      ))}
      {showConnectSection ? connectSection : null}
      {reposLoading && flatRows.length > 0 ? (
        <p className="px-2 py-1 text-meta text-text-faint">Updating repositories…</p>
      ) : null}
    </div>
  );
}

function LauncherResultRow({
  row,
  active,
  selected,
  onMouseEnter,
  onClick
}: {
  row: WorkspaceLauncherRow;
  active: boolean;
  selected: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const icon =
    row.kind === 'local-browse' || row.kind === 'local-recent' || row.kind === 'local-path-submit' ? (
      <FolderOpen className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
    ) : (
      <FolderGit2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
    );
  let primary = '';
  let detail: string | null = null;

  switch (row.kind) {
    case 'local-recent':
    case 'local-path-submit':
      primary = row.path;
      break;
    case 'local-browse':
      primary = 'Browse folder…';
      break;
    case 'github-recent':
      primary = `${row.recent.owner}/${row.recent.repo}`;
      detail = `@ ${row.recent.branch}`;
      break;
    case 'github-repo':
      primary = row.repo.fullName;
      detail = row.description;
      break;
    case 'github-connect':
      primary = 'Connect GitHub account…';
      detail = 'Sign in or paste a token';
      break;
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }

  return (
    <button
      type="button"
      role="option"
      aria-selected={active || selected}
      aria-label={row.ariaLabel}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        'vx-dock-search-row vx-dropdown-item flex w-full items-center gap-2 rounded-inner px-2 py-1.5 text-left',
        (active || selected) && 'bg-dock-selection'
      )}
    >
      <span className="shrink-0 text-text-faint">{icon}</span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-row',
            row.kind === 'local-recent' || row.kind === 'local-path-submit' ? 'font-mono' : '',
            active || selected ? 'text-text-primary' : 'text-text-secondary'
          )}
        >
          {primary}
        </span>
        {detail ? (
          <span className="block truncate text-meta text-text-faint">{detail}</span>
        ) : null}
      </span>
    </button>
  );
}
