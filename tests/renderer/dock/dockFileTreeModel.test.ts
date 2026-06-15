import { describe, expect, it } from 'vitest';
import {
  ancestorFolderPaths,
  buildDockFileTree,
  dockTreeRelativePath,
  expandFoldersForFilter,
  filterDockTreePaths,
  flattenDockTreeNodes,
  flattenLazyDockTree,
  normalizeDockTreePath
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
