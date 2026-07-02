/**
 * Source control file list models — flat rows and directory tree.
 */

import type { GitPathStatus } from '@shared/types/ipc.js';

export type SourceControlSection = 'staged' | 'unstaged';

export interface SourceControlFileRow {
  path: string;
  status: GitPathStatus;
  section: SourceControlSection;
}

export interface SourceControlTreeNode {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  children?: SourceControlTreeNode[];
  file?: SourceControlFileRow;
}

export function buildSourceControlRows(
  staged: Record<string, GitPathStatus>,
  unstaged: Record<string, GitPathStatus>
): { stagedRows: SourceControlFileRow[]; unstagedRows: SourceControlFileRow[] } {
  const stagedRows = Object.entries(staged)
    .map(([path, status]) => ({ path, status, section: 'staged' as const }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const unstagedRows = Object.entries(unstaged)
    .map(([path, status]) => ({ path, status, section: 'unstaged' as const }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { stagedRows, unstagedRows };
}

function insertTreeNode(
  root: SourceControlTreeNode[],
  parts: string[],
  file: SourceControlFileRow,
  parentPath = ''
): void {
  if (parts.length === 0) return;
  const [head, ...rest] = parts;
  if (!head) return;
  const isFile = rest.length === 0;
  const pathSoFar = parentPath ? `${parentPath}/${head}` : head;
  let node = root.find((n) => n.name === head && n.kind === (isFile ? 'file' : 'folder'));
  if (!node) {
    node = {
      name: head,
      path: isFile ? file.path : pathSoFar,
      kind: isFile ? 'file' : 'folder',
      ...(isFile ? { file } : { children: [] })
    };
    root.push(node);
  }
  if (isFile) {
    node.file = file;
    node.kind = 'file';
    node.path = file.path;
    return;
  }
  if (!node.children) node.children = [];
  node.path = pathSoFar;
  insertTreeNode(node.children, rest, file, pathSoFar);
}

export function buildSourceControlTree(rows: SourceControlFileRow[]): SourceControlTreeNode[] {
  const root: SourceControlTreeNode[] = [];
  for (const row of rows) {
    insertTreeNode(root, row.path.split('/'), row);
  }
  const sortNodes = (nodes: SourceControlTreeNode[]): SourceControlTreeNode[] =>
    nodes
      .map((n) =>
        n.children ? { ...n, children: sortNodes(n.children) } : n
      )
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  return sortNodes(root);
}

export function flattenSourceControlTree(
  nodes: SourceControlTreeNode[],
  depth = 0,
  expanded: Set<string>
): Array<{ node: SourceControlTreeNode; depth: number }> {
  const out: Array<{ node: SourceControlTreeNode; depth: number }> = [];
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.kind === 'folder' && node.children && expanded.has(node.path)) {
      out.push(...flattenSourceControlTree(node.children, depth + 1, expanded));
    }
  }
  return out;
}
