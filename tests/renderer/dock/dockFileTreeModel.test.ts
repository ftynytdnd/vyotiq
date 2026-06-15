import { describe, expect, it } from 'vitest';
import {
  ancestorFolderPaths,
  buildDockFileTree,
  dockTreeRelativePath,
  expandFoldersForFilter,
  filterDockTreePaths,
  flatRowIndexRange,
  flattenDockTreeNodes,
  flattenLazyDockTree,
  normalizeDockTreePath,
  parentFolderPath,
  resolveStickyFolderRow,
  siblingFolderPaths,
  DOCK_TREE_ROW_HEIGHT_PX
} from '../../../src/renderer/components/dock/dockFileTreeModel.js';

describe('buildDockFileTree', () => {
  it('sorts directories before files', () => {
    const tree = buildDockFileTree(['src/main.ts', 'src/', 'README.md']);
    expect(tree.map((n) => n.name)).toEqual(['src', 'README.md']);
    expect(tree[0]?.children.map((n) => n.name)).toEqual(['main.ts']);
  });
});

describe('filterDockTreePaths', () => {
  const paths = ['src/', 'src/main.ts', 'docs/', 'docs/readme.md'];

  it('returns all paths when filter is empty', () => {
    expect(filterDockTreePaths(paths, '')).toEqual(paths);
  });

  it('keeps ancestor folders for file matches', () => {
    const filtered = filterDockTreePaths(paths, 'main');
    expect(filtered).toContain('src/');
    expect(filtered).toContain('src/main.ts');
    expect(filtered).not.toContain('docs/readme.md');
  });
});

describe('ancestorFolderPaths', () => {
  it('returns parent folders for nested files', () => {
    expect(ancestorFolderPaths('src/components/App.tsx')).toEqual(['src', 'src/components']);
  });
});

describe('dockTreeRelativePath', () => {
  it('strips workspace root from absolute paths', () => {
    expect(dockTreeRelativePath('C:/ws/src/main.ts', 'C:/ws')).toBe('src/main.ts');
  });

  it('keeps relative paths unchanged', () => {
    expect(dockTreeRelativePath('src/main.ts', 'C:/ws')).toBe('src/main.ts');
  });
});

describe('expandFoldersForFilter', () => {
  const paths = ['src/', 'src/main.ts', 'docs/', 'docs/readme.md'];

  it('returns ancestor folders for file matches', () => {
    expect(expandFoldersForFilter(paths, 'readme')).toEqual(['docs']);
  });
});

describe('normalizeDockTreePath', () => {
  it('normalizes slashes and leading separators', () => {
    expect(normalizeDockTreePath('\\src\\main.ts')).toBe('src/main.ts');
  });
});

describe('flattenLazyDockTree', () => {
  it('walks expanded folders only', () => {
    const childrenByDir = new Map<string, string[]>([
      ['', ['src/', 'README.md']],
      ['src', ['src/main.ts']]
    ]);
    const expanded = new Set(['src']);
    const rows = flattenLazyDockTree(childrenByDir, expanded, new Set());
    expect(rows.map((r) => r.path)).toEqual(['src', 'src/main.ts', 'README.md']);
  });
});

describe('flattenDockTreeNodes', () => {
  it('flattens nested tree for filter mode', () => {
    const tree = buildDockFileTree(['src/', 'src/main.ts']);
    const rows = flattenDockTreeNodes(tree, new Set(['src']));
    expect(rows.map((r) => r.path)).toEqual(['src', 'src/main.ts']);
  });
});

describe('parentFolderPath', () => {
  it('returns parent segments', () => {
    expect(parentFolderPath('src/main.ts')).toBe('src');
    expect(parentFolderPath('src')).toBe('');
  });
});

describe('siblingFolderPaths', () => {
  it('lists peer folders under the same parent', () => {
    const rows = flattenLazyDockTree(
      new Map([
        ['', ['src/', 'docs/', 'README.md']],
        ['src', ['src/components/', 'src/main.ts']],
        ['docs', ['docs/readme.md']]
      ]),
      new Set(['src', 'docs', 'src/components']),
      new Set()
    );
    expect(siblingFolderPaths(rows, 'src/main.ts')).toEqual(['src/components']);
    expect(siblingFolderPaths(rows, 'src/components')).toEqual(['src/components']);
    expect(siblingFolderPaths(rows, 'src').sort()).toEqual(['docs', 'src']);
  });
});

describe('resolveStickyFolderRow', () => {
  it('returns scrolled-off parent folder for nested rows', () => {
    const rows = flattenLazyDockTree(
      new Map([
        ['', ['src/']],
        ['src', ['src/components/', 'src/main.ts']],
        ['src/components', ['src/components/App.tsx']]
      ]),
      new Set(['src', 'src/components']),
      new Set()
    );
    const scrollTop = DOCK_TREE_ROW_HEIGHT_PX * 3.5;
    expect(resolveStickyFolderRow(rows, scrollTop)?.path).toBe('src');
  });
});

describe('flatRowIndexRange', () => {
  it('orders endpoints', () => {
    expect(flatRowIndexRange(4, 1)).toEqual({ from: 1, to: 4 });
  });
});
