/**
 * Workspace file/folder rows for the composer `@` mention picker.
 * Reuses the dock file-tree model for consistent hierarchy and filtering.
 */

import {
  buildDockFileTree,
  expandFoldersForFilter,
  filterDockTreePaths,
  flattenDockTreeNodes
} from '../../dock/dockFileTreeModel.js';
import type { MentionPickerRow } from './useMentionPicker.js';

export const MENTION_FILE_TREE_MAX_ROWS = 80;

export interface MentionFileTreeRow extends MentionPickerRow {
  depth: number;
  isDir: boolean;
  /** Folder rows expand/collapse; file rows insert a mention. */
  selectable: boolean;
  isExpanded?: boolean;
}

export function initialMentionFolderExpansion(paths: string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of paths) {
    const p = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (!p) continue;
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      set.add(parts.slice(0, i).join('/'));
    }
  }
  return set;
}

export function buildMentionFileTreeRows(input: {
  paths: string[];
  query: string;
  mentionedPaths: string[];
  expandedFolders: ReadonlySet<string>;
}): MentionFileTreeRow[] {
  const { paths, query, mentionedPaths, expandedFolders } = input;
  const q = query.trim();
  const filtered = q ? filterDockTreePaths(paths, q) : paths;
  const tree = buildDockFileTree(filtered);

  const expandedSet = q
    ? new Set(expandFoldersForFilter(paths, q))
    : new Set(expandedFolders);

  const flat = flattenDockTreeNodes(tree, expandedSet);
  const rows: MentionFileTreeRow[] = [];

  for (const entry of flat) {
    if (rows.length >= MENTION_FILE_TREE_MAX_ROWS) break;
    if (entry.isDir) {
      rows.push({
        id: `folder:${entry.path}`,
        kind: 'workspace-folder',
        label: entry.name,
        subtitle: entry.path,
        path: entry.path,
        depth: entry.depth,
        isDir: true,
        selectable: false,
        isExpanded: entry.isExpanded
      });
      continue;
    }
    rows.push({
      id: `file:${entry.path}`,
      kind: 'workspace-file',
      label: entry.path,
      subtitle: entry.path.includes('/') ? entry.path.replace(/\/[^/]+$/, '') : '',
      path: entry.path,
      depth: entry.depth,
      isDir: false,
      selectable: true,
      disabled: mentionedPaths.includes(entry.path)
    });
  }

  return rows;
}

export function isMentionPickerSelectable(row: MentionPickerRow): boolean {
  if (row.kind === 'workspace-folder') return false;
  if (row.disabled) return false;
  return true;
}
