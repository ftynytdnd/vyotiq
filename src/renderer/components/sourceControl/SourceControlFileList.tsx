/**
 * Source control changed-files list — collapsible staged / unstaged tree.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Minus, Plus, Search, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { gitStatusAriaLabel, gitStatusBadgeCn } from '../../lib/dockGitTreeStyle.js';
import { FileIconForPath } from '../../lib/fileIconForPath.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';
import {
  buildSourceControlTree,
  flattenSourceControlTree,
  type SourceControlFileRow,
  type SourceControlSection,
  type SourceControlTreeNode
} from './sourceControlModel.js';
import { SourceControlPathLabel } from './sourceControlPathLabel.js';

const TREE_INDENT_PX = 12;
const TREE_BASE_PADDING_PX = 8;

function FileStatusBadge({ status }: { status: SourceControlFileRow['status'] }) {
  return (
    <span
      className={cn(gitStatusBadgeCn(status), 'vx-sc-status-badge shrink-0')}
      aria-label={gitStatusAriaLabel(status)}
    >
      {status}
    </span>
  );
}

function TreeFolderRow({
  node,
  depth,
  expanded,
  onToggle
}: {
  node: SourceControlTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  return (
    <button
      type="button"
      className="vx-sc-folder-row"
      style={{ paddingLeft: `${TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX}px` }}
      onClick={() => onToggle(node.path)}
    >
      {isOpen ? (
        <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
      ) : (
        <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
      )}
      <FileIconForPath filePath={node.path} isDir isExpanded={isOpen} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function SectionHeader({
  title,
  count,
  collapsed,
  bulkLabel,
  bulkDisabled,
  onBulk,
  onToggle
}: {
  title: string;
  count: number;
  collapsed: boolean;
  bulkLabel?: string;
  bulkDisabled?: boolean;
  onBulk?: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="vx-sc-section-head-row">
      <button
        type="button"
        className="vx-sc-section-head"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
        ) : (
          <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} aria-hidden />
        )}
        <span className="vx-sc-section-title">{title}</span>
        <span className="vx-sc-section-count">{count}</span>
      </button>
      {bulkLabel && onBulk ? (
        <button
          type="button"
          className="vx-sc-section-bulk"
          disabled={bulkDisabled}
          title={bulkLabel}
          aria-label={bulkLabel}
          onClick={onBulk}
        >
          {bulkLabel}
        </button>
      ) : null}
    </div>
  );
}

function filterRows(rows: SourceControlFileRow[], query: string): SourceControlFileRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => row.path.toLowerCase().includes(q));
}

interface SourceControlFileListProps {
  stagedRows: SourceControlFileRow[];
  unstagedRows: SourceControlFileRow[];
  expandedFolders: Set<string>;
  selected: SourceControlFileRow | null;
  onFolderToggle: (path: string) => void;
  onSelect: (row: SourceControlFileRow) => void;
  onStage?: (row: SourceControlFileRow) => void;
  onUnstage?: (row: SourceControlFileRow) => void;
  onDiscard?: (row: SourceControlFileRow) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
  readOnly?: boolean;
  className?: string;
}

export function SourceControlFileList({
  stagedRows,
  unstagedRows,
  expandedFolders,
  selected,
  onFolderToggle,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  onStageAll,
  onUnstageAll,
  readOnly = false,
  className
}: SourceControlFileListProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<SourceControlSection>>(() => new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');

  const filteredStaged = useMemo(() => filterRows(stagedRows, filterQuery), [stagedRows, filterQuery]);
  const filteredUnstaged = useMemo(() => filterRows(unstagedRows, filterQuery), [unstagedRows, filterQuery]);

  const toggleSection = (section: SourceControlSection) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const renderFileRow = (row: SourceControlFileRow, depth = 0) => {
    const active = selected?.path === row.path && selected.section === row.section;
    return (
      <div
        key={`${row.section}:${row.path}`}
        className={cn('vx-sc-file-row group', active && 'vx-sc-file-row--active')}
        style={{ paddingLeft: `${TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX}px` }}
      >
        <button
          type="button"
          className="vx-sc-file-row-main"
          role={readOnly ? 'option' : undefined}
          aria-selected={readOnly ? active : undefined}
          onClick={() => onSelect(row)}
        >
          <FileIconForPath filePath={row.path} />
          <FileStatusBadge status={row.status} />
          <SourceControlPathLabel
            path={row.path}
            status={row.status}
            variant="basename"
            className="min-w-0 flex-1"
          />
        </button>
        {!readOnly && onStage && onUnstage && onDiscard ? (
          <div className="vx-sc-file-row-actions">
            {row.section === 'unstaged' ? (
              <button
                type="button"
                className="vx-sc-row-action"
                title="Stage"
                aria-label={`Stage ${row.path}`}
                onClick={() => onStage(row)}
              >
                <Plus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
              </button>
            ) : (
              <button
                type="button"
                className="vx-sc-row-action"
                title="Unstage"
                aria-label={`Unstage ${row.path}`}
                onClick={() => onUnstage(row)}
              >
                <Minus className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
              </button>
            )}
            <button
              type="button"
              className="vx-sc-row-action vx-sc-row-action--danger"
              title="Discard"
              aria-label={`Discard changes in ${row.path}`}
              onClick={() => onDiscard(row)}
            >
              <Trash2 className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderSection = (
    title: string,
    section: SourceControlSection,
    rows: SourceControlFileRow[],
    bulkLabel?: string,
    onBulk?: () => void
  ) => {
    if (rows.length === 0) return null;
    const collapsed = collapsedSections.has(section);
    const tree = buildSourceControlTree(rows);
    const flat = flattenSourceControlTree(tree, 0, expandedFolders);

    return (
      <section className="vx-sc-section" key={section}>
        <SectionHeader
          title={title}
          count={rows.length}
          collapsed={collapsed}
          bulkLabel={readOnly ? undefined : bulkLabel}
          bulkDisabled={!onBulk}
          onBulk={onBulk}
          onToggle={() => toggleSection(section)}
        />
        {!collapsed ? (
          <div className="vx-sc-section-body">
            {flat.map(({ node, depth }) =>
              node.kind === 'folder' && node.children ? (
                <TreeFolderRow
                  key={`folder:${node.path}`}
                  node={node}
                  depth={depth}
                  expanded={expandedFolders}
                  onToggle={onFolderToggle}
                />
              ) : node.file ? (
                renderFileRow(node.file, depth)
              ) : null
            )}
          </div>
        ) : null}
      </section>
    );
  };

  const total = stagedRows.length + unstagedRows.length;
  const filteredTotal = filteredStaged.length + filteredUnstaged.length;

  return (
    <div
      className={cn('vx-sc-changes-pane scrollbar-stealth', className)}
      role={readOnly ? 'listbox' : undefined}
      aria-label={readOnly ? 'Changed files' : undefined}
    >
      {total > 8 ? (
        <div className="vx-sc-changes-toolbar">
          <button
            type="button"
            className={cn('vx-sc-changes-filter-toggle', filterOpen && 'vx-sc-changes-filter-toggle--open')}
            aria-label="Filter files"
            aria-pressed={filterOpen}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <Search className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
          </button>
          {filterOpen ? (
            <div className="vx-sc-changes-filter">
              <input
                type="search"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Filter…"
                className="vx-sc-changes-filter-input app-no-drag"
                aria-label="Filter changed files"
                autoFocus
              />
              {filterQuery ? (
                <button
                  type="button"
                  className="vx-sc-changes-filter-clear"
                  aria-label="Clear filter"
                  onClick={() => setFilterQuery('')}
                >
                  <X className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
                </button>
              ) : null}
            </div>
          ) : (
            <span className="vx-sc-changes-toolbar-count">
              {filterQuery ? `${filteredTotal}/${total}` : total} files
            </span>
          )}
        </div>
      ) : null}

      {filterQuery && filteredTotal === 0 ? (
        <div className="vx-sc-changes-no-match">No files match &ldquo;{filterQuery}&rdquo;</div>
      ) : (
        <>
          {renderSection('Staged', 'staged', filteredStaged, 'Unstage all', onUnstageAll)}
          {renderSection('Changes', 'unstaged', filteredUnstaged, 'Stage all', onStageAll)}
        </>
      )}
    </div>
  );
}

/** Collect parent folder paths; when many files, only top-level folders. */
export function collectChangedFolderPaths(
  rows: SourceControlFileRow[],
  opts?: { collapseDeep?: boolean }
): Set<string> {
  const collapseDeep = opts?.collapseDeep ?? rows.length > 24;
  const folders = new Set<string>();
  for (const row of rows) {
    const parts = row.path.split('/');
    if (collapseDeep) {
      if (parts.length > 1) folders.add(parts[0]!);
      continue;
    }
    for (let i = 1; i < parts.length; i++) {
      folders.add(parts.slice(0, i).join('/'));
    }
  }
  return folders;
}
