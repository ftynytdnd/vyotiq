/**
 * Multi-select helpers for the dock file tree.
 */

import type { FlatTreeRow } from '../components/dock/dockFileTreeModel.js';

export interface DockTreeDeleteTarget {
  path: string;
  isDir: boolean;
}

/** Map selected paths to delete targets using the current flat row metadata. */
export function selectionTargetsFromPaths(
  selectedPaths: ReadonlySet<string>,
  rows: readonly FlatTreeRow[]
): DockTreeDeleteTarget[] {
  const byPath = new Map(rows.map((row) => [row.path, row]));
  const targets: DockTreeDeleteTarget[] = [];
  for (const path of selectedPaths) {
    const row = byPath.get(path);
    targets.push({ path, isDir: row?.isDir ?? false });
  }
  return pruneNestedDeleteTargets(targets);
}

/** Drop child paths when an ancestor folder is already slated for deletion. */
export function pruneNestedDeleteTargets(
  targets: readonly DockTreeDeleteTarget[]
): DockTreeDeleteTarget[] {
  const sorted = [...targets].sort((a, b) => a.path.localeCompare(b.path));
  const kept: DockTreeDeleteTarget[] = [];
  for (const target of sorted) {
    if (kept.some((k) => target.path === k.path || target.path.startsWith(`${k.path}/`))) {
      continue;
    }
    kept.push(target);
  }
  return kept;
}

export function allVisibleRowPaths(rows: readonly FlatTreeRow[]): string[] {
  return rows.map((row) => row.path);
}
