/**
 * Pure grouping helpers for the pending-changes panel.
 *
 * Two grouping axes are supported (the panel exposes both as
 * filters):
 *
 *   - `groupByRun`     — preserves the historical run-grouping
 *      behaviour. One bucket per `runId`, in original insertion
 *      order so the first appearance of a runId is the oldest
 *      entry for that run (matches the store's createdAt-asc
 *      ordering).
 *   - `groupByFolder`  — buckets entries by their containing
 *      directory (workspace-relative), e.g.
 *      `src/renderer/components/checkpoints/`. Entries at the
 *      workspace root land in the `''` bucket which the renderer
 *      labels `(root)`.
 *
 * Pure / no React imports — safe inside `useMemo` and unit tests.
 */

import type { PendingChange } from '@shared/types/checkpoint.js';

export interface RunBucket {
  runId: string;
  entries: PendingChange[];
}

export interface FolderBucket {
  folder: string;
  entries: PendingChange[];
}

export interface FilePathBucket {
  workspaceId: string;
  filePath: string;
  entries: PendingChange[];
}

export function fileGroupKey(workspaceId: string, filePath: string): string {
  return `${workspaceId}\u0000${filePath}`;
}

export interface PendingStats {
  additions: number;
  deletions: number;
}

export function groupByRun(pending: readonly PendingChange[]): RunBucket[] {
  const byRun = new Map<string, PendingChange[]>();
  for (const p of pending) {
    const arr = byRun.get(p.runId);
    if (arr) arr.push(p);
    else byRun.set(p.runId, [p]);
  }
  return Array.from(byRun, ([runId, entries]) => ({ runId, entries }));
}

/** Sum diff stats across one or more pending rows. */
export function aggregatePendingStats(
  entries: readonly PendingChange[]
): PendingStats {
  let additions = 0;
  let deletions = 0;
  for (const entry of entries) {
    additions += entry.additions;
    deletions += entry.deletions;
  }
  return { additions, deletions };
}

/**
 * Buckets pending rows by `(workspaceId, filePath)`. Multiple checkpoint
 * entries for the same path in one workspace collapse into one group.
 */
export function groupByFilePath(pending: readonly PendingChange[]): FilePathBucket[] {
  const byKey = new Map<string, PendingChange[]>();
  for (const p of pending) {
    const key = fileGroupKey(p.workspaceId, p.filePath);
    const arr = byKey.get(key);
    if (arr) arr.push(p);
    else byKey.set(key, [p]);
  }
  return Array.from(byKey, ([, entries]) => ({
    workspaceId: entries[0]!.workspaceId,
    filePath: entries[0]!.filePath,
    entries
  }));
}

export function groupByFolder(pending: readonly PendingChange[]): FolderBucket[] {
  const byFolder = new Map<string, PendingChange[]>();
  for (const p of pending) {
    const folder = folderOf(p.filePath);
    const arr = byFolder.get(folder);
    if (arr) arr.push(p);
    else byFolder.set(folder, [p]);
  }
  // Sort folders alphabetically (root first) so the visual order
  // is stable across renders. Entries inside each folder keep
  // their store-imposed order (createdAt asc).
  return Array.from(byFolder, ([folder, entries]) => ({ folder, entries })).sort(
    (a, b) => {
      if (a.folder === '' && b.folder !== '') return -1;
      if (b.folder === '' && a.folder !== '') return 1;
      return a.folder.localeCompare(b.folder);
    }
  );
}

/** Workspace-relative folder of `filePath`, or `''` for root entries. */
function folderOf(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (idx <= 0) return '';
  return filePath.slice(0, idx);
}

/**
 * Match a path-prefix filter against a `PendingChange`. Case-
 * insensitive substring match against the `filePath`. An empty
 * filter matches every entry.
 */
export function matchesPathFilter(
  change: PendingChange,
  filter: string
): boolean {
  const trimmed = filter.trim();
  if (trimmed.length === 0) return true;
  return change.filePath.toLowerCase().includes(trimmed.toLowerCase());
}

/** Filter the pending list against (runId | path) filters. */
export interface PendingFilters {
  /** When set, only entries whose `runId` matches are returned. */
  runId: string | null;
  /** Substring filter against `filePath` (case-insensitive). */
  pathQuery: string;
}

export function applyPendingFilters(
  pending: readonly PendingChange[],
  filters: PendingFilters
): PendingChange[] {
  const out: PendingChange[] = [];
  for (const p of pending) {
    if (filters.runId !== null && p.runId !== filters.runId) continue;
    if (!matchesPathFilter(p, filters.pathQuery)) continue;
    out.push(p);
  }
  return out;
}

/** Count distinct file paths in a pending list. */
export function countDistinctFilePaths(pending: readonly PendingChange[]): number {
  const seen = new Set<string>();
  for (const p of pending) {
    seen.add(fileGroupKey(p.workspaceId, p.filePath));
  }
  return seen.size;
}
