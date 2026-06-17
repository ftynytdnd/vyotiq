/**
 * Pure helpers for the dock file tree — build, filter, ancestor paths.
 */

export interface DockTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: DockTreeNode[];
}

export const DOCK_TREE_INDENT_PX = 16;
export const DOCK_TREE_ROW_HEIGHT_PX = 28;

export interface FlatTreeRow {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  isExpanded: boolean;
  isLoading?: boolean;
  hasLoadedChildren: boolean;
}

/** Sort child path entries — directories first, then locale name order. */
function sortDockChildEntries(entries: string[]): string[] {
  return [...entries].sort((a, b) => {
    const aDir = a.endsWith('/');
    const bDir = b.endsWith('/');
    if (aDir !== bDir) return aDir ? -1 : 1;
    const aName = a.endsWith('/') ? a.slice(0, -1) : a;
    const bName = b.endsWith('/') ? b.slice(0, -1) : b;
    const aBase = aName.split('/').pop() ?? aName;
    const bBase = bName.split('/').pop() ?? bName;
    return aBase.localeCompare(bBase);
  });
}

/**
 * Flatten the lazy-loaded tree for virtualization — walks expanded folders
 * using `childrenByDir` keyed by parent path (`''` = workspace root).
 */
export function flattenLazyDockTree(
  childrenByDir: ReadonlyMap<string, string[]>,
  expandedSet: ReadonlySet<string>,
  loadingDirs: ReadonlySet<string>
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];

  const walk = (dirPath: string, depth: number): void => {
    const children = childrenByDir.get(dirPath);
    if (!children) return;
    for (const raw of sortDockChildEntries(children)) {
      const isDir = raw.endsWith('/');
      const path = isDir ? raw.slice(0, -1) : raw;
      const name = path.split('/').pop() ?? path;
      const isExpanded = isDir && expandedSet.has(path);
      const hasLoadedChildren = childrenByDir.has(path);
      rows.push({
        path,
        name,
        depth,
        isDir,
        isExpanded,
        isLoading: isDir && loadingDirs.has(path),
        hasLoadedChildren
      });
      if (isDir && isExpanded && hasLoadedChildren) {
        walk(path, depth + 1);
      }
    }
  };

  walk('', 0);
  return rows;
}

/** Flatten a pre-built nested tree (filter / bulk-list mode). */
export function flattenDockTreeNodes(
  nodes: DockTreeNode[],
  expandedSet: ReadonlySet<string>,
  depth = 0
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  for (const node of nodes) {
    const isExpanded = node.isDir && expandedSet.has(node.path);
    rows.push({
      path: node.path,
      name: node.name,
      depth,
      isDir: node.isDir,
      isExpanded,
      hasLoadedChildren: true
    });
    if (node.isDir && isExpanded) {
      rows.push(...flattenDockTreeNodes(node.children, expandedSet, depth + 1));
    }
  }
  return rows;
}

export function buildDockFileTree(paths: string[]): DockTreeNode[] {
  const root: DockTreeNode[] = [];
  const dirMap = new Map<string, DockTreeNode>();

  const ensureDir = (dirPath: string, name: string): DockTreeNode => {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;
    const node: DockTreeNode = { name, path: dirPath, isDir: true, children: [] };
    dirMap.set(dirPath, node);
    const parentPath = dirPath.includes('/') ? dirPath.replace(/\/[^/]+\/?$/, '') : '';
    if (!parentPath) {
      root.push(node);
    } else {
      const parentName = parentPath.split('/').pop() ?? parentPath;
      const parent = ensureDir(
        parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath,
        parentName
      );
      if (!parent.children.some((c) => c.path === node.path)) parent.children.push(node);
    }
    return node;
  };

  for (const raw of paths) {
    const p = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (!p) continue;
    const parts = p.split('/');
    const name = parts[parts.length - 1] ?? p;
    if (raw.endsWith('/')) {
      ensureDir(p, name);
      continue;
    }
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
    const fileNode: DockTreeNode = { name, path: p, isDir: false, children: [] };
    if (!parentPath) {
      root.push(fileNode);
    } else {
      const parentName = parentPath.split('/').pop() ?? parentPath;
      const parent = ensureDir(parentPath, parentName);
      parent.children.push(fileNode);
    }
  }

  const sortNodes = (nodes: DockTreeNode[]): DockTreeNode[] =>
    [...nodes]
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sortNodes(n.children) }));

  return sortNodes(root);
}

/** Case-insensitive filter; keeps ancestor dirs so matches stay reachable. */
export function filterDockTreePaths(paths: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return paths;

  const keep = new Set<string>();
  for (const raw of paths) {
    const p = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (!p) continue;
    if (!p.toLowerCase().includes(q) && !p.split('/').some((seg) => seg.toLowerCase().includes(q))) {
      continue;
    }
    keep.add(raw);
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = `${parts.slice(0, i).join('/')}/`;
      if (paths.includes(dir)) keep.add(dir);
      const dirNoSlash = parts.slice(0, i).join('/');
      if (paths.includes(dirNoSlash)) keep.add(dirNoSlash);
    }
  }
  return paths.filter((p) => keep.has(p));
}

/** Folder paths to expand while a filter is active so matches stay visible. */
export function expandFoldersForFilter(paths: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const folders = new Set<string>();
  for (const raw of paths) {
    const p = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (!p || raw.endsWith('/')) continue;
    if (!p.toLowerCase().includes(q) && !p.split('/').some((seg) => seg.toLowerCase().includes(q))) {
      continue;
    }
    for (const ancestor of ancestorFolderPaths(p)) {
      folders.add(ancestor);
    }
  }
  return Array.from(folders);
}

/** Relative folder paths to expand so `targetPath` is visible. */
export function ancestorFolderPaths(targetPath: string): string[] {
  const norm = targetPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = norm.split('/').filter(Boolean);
  if (parts.length <= 1) return [];
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join('/'));
  }
  return ancestors;
}

export function normalizeDockTreePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

/** Map an editor tab path to the workspace-relative form used by the tree. */
export function dockTreeRelativePath(filePath: string, workspacePath: string): string {
  const normFile = filePath.replace(/\\/g, '/');
  const normRoot = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');
  if (normRoot && normFile.toLowerCase().startsWith(`${normRoot.toLowerCase()}/`)) {
    return normalizeDockTreePath(normFile.slice(normRoot.length + 1));
  }
  return normalizeDockTreePath(filePath);
}

/** Parent folder path for a tree entry (`''` = workspace root). */
export function parentFolderPath(path: string): string {
  const norm = normalizeDockTreePath(path);
  const idx = norm.lastIndexOf('/');
  return idx < 0 ? '' : norm.slice(0, idx);
}

/** Direct child folder paths that share the same parent as `targetPath`. */
export function siblingFolderPaths(rows: readonly FlatTreeRow[], targetPath: string): string[] {
  const target = rows.find((r) => r.path === targetPath);
  if (!target) return [];
  const parentPath = parentFolderPath(target.path);
  return rows
    .filter((r) => r.isDir && parentFolderPath(r.path) === parentPath)
    .map((r) => r.path);
}

/**
 * Deepest expanded ancestor folder scrolled off the top — drives the sticky header.
 */
export function resolveStickyFolderRow(
  rows: readonly FlatTreeRow[],
  scrollTop: number
): FlatTreeRow | null {
  if (scrollTop < DOCK_TREE_ROW_HEIGHT_PX || rows.length === 0) return null;

  const firstVisible = Math.min(
    rows.length - 1,
    Math.floor(scrollTop / DOCK_TREE_ROW_HEIGHT_PX)
  );
  const firstRow = rows[firstVisible];
  if (!firstRow || firstRow.depth === 0) return null;

  for (let depth = firstRow.depth - 1; depth >= 0; depth--) {
    for (let i = firstVisible; i >= 0; i--) {
      const row = rows[i];
      if (!row?.isDir || !row.isExpanded || row.depth !== depth) continue;
      const rowTop = i * DOCK_TREE_ROW_HEIGHT_PX;
      if (rowTop < scrollTop) return row;
    }
  }
  return null;
}

/** Inclusive index range between two flat row indices. */
export function flatRowIndexRange(a: number, b: number): { from: number; to: number } {
  return { from: Math.min(a, b), to: Math.max(a, b) };
}
