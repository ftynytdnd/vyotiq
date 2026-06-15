import { describe, expect, it } from 'vitest';
import {
  allVisibleRowPaths,
  pruneNestedDeleteTargets,
  selectionTargetsFromPaths
} from '@renderer/lib/dockFileTreeSelection';
import type { FlatTreeRow } from '@renderer/components/dock/dockFileTreeModel';

const rows: FlatTreeRow[] = [
  {
    path: 'src',
    name: 'src',
    depth: 0,
    isDir: true,
    isExpanded: true,
    hasLoadedChildren: true
  },
  {
    path: 'src/main.ts',
    name: 'main.ts',
    depth: 1,
    isDir: false,
    isExpanded: false,
    hasLoadedChildren: false
  },
  {
    path: 'docs',
    name: 'docs',
    depth: 0,
    isDir: true,
    isExpanded: false,
    hasLoadedChildren: true
  }
];

describe('dockFileTreeSelection', () => {
  it('maps selected paths to delete targets', () => {
    const targets = selectionTargetsFromPaths(new Set(['src/main.ts', 'docs']), rows);
    expect(targets).toEqual([
      { path: 'docs', isDir: true },
      { path: 'src/main.ts', isDir: false }
    ]);
  });

  it('prunes nested delete targets', () => {
    expect(
      pruneNestedDeleteTargets([
        { path: 'src', isDir: true },
        { path: 'src/main.ts', isDir: false }
      ])
    ).toEqual([{ path: 'src', isDir: true }]);
  });

  it('lists all visible row paths', () => {
    expect(allVisibleRowPaths(rows)).toEqual(['src', 'src/main.ts', 'docs']);
  });
});
