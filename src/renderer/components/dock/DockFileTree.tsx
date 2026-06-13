/**
 * Collapsible workspace file tree for the left dock.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { getWorkspaceTree } from '../../lib/workspaceTreeCache.js';
import { openWorkspaceFileInEditor } from '../../lib/openWorkspaceFileInEditor.js';
import { useWorkspaceStore } from '../../store/useWorkspaceStore.js';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  const ensureDir = (dirPath: string, name: string): TreeNode => {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;
    const node: TreeNode = { name, path: dirPath, isDir: true, children: [] };
    dirMap.set(dirPath, node);
    const parentPath = dirPath.includes('/') ? dirPath.replace(/\/[^/]+\/?$/, '') : '';
    if (!parentPath) {
      root.push(node);
    } else {
      const parentName = parentPath.split('/').pop() ?? parentPath;
      const parent = ensureDir(parentPath.endsWith('/') ? parentPath.slice(0, -1) : parentPath, parentName);
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
    const fileNode: TreeNode = { name, path: p, isDir: false, children: [] };
    if (!parentPath) {
      root.push(fileNode);
    } else {
      const parentName = parentPath.split('/').pop() ?? parentPath;
      const parent = ensureDir(parentPath, parentName);
      parent.children.push(fileNode);
    }
  }

  const sortNodes = (nodes: TreeNode[]): TreeNode[] =>
    [...nodes]
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sortNodes(n.children) }));

  return sortNodes(root);
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const Icon = node.isDir ? Folder : File;

  return (
    <>
      <button
        type="button"
        className={cn(
          'flex w-full min-w-0 items-center gap-1 rounded-md py-1 pr-2 text-left font-mono text-row text-text-secondary chrome-hover-soft',
          !node.isDir && 'text-text-primary'
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => {
          if (node.isDir) onToggle(node.path);
          else void onOpenFile(node.path);
        }}
      >
        {node.isDir ? (
          isOpen ? (
            <ChevronDown className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          ) : (
            <ChevronRight className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          )
        ) : (
          <span className="inline-block w-3.5 shrink-0" aria-hidden />
        )}
        <Icon className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
        <span className="min-w-0 truncate">{node.name}</span>
      </button>
      {node.isDir && isOpen
        ? node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpenFile={onOpenFile}
            />
          ))
        : null}
    </>
  );
}

export interface DockFileTreeProps {
  workspaceId: string | null;
}

export function DockFileTree({ workspaceId }: DockFileTreeProps) {
  const workspacePath = useWorkspaceStore((s) => {
    const entry = workspaceId ? s.list.find((w) => w.id === workspaceId) : undefined;
    return entry?.path ?? s.info.path ?? '';
  });
  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['src']));

  useEffect(() => {
    if (!workspacePath) {
      setPaths([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getWorkspaceTree(workspacePath, 5, workspaceId ?? undefined)
      .then((result) => {
        if (!cancelled) setPaths(result.entries);
      })
      .catch(() => {
        if (!cancelled) setPaths([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, workspaceId]);

  const tree = useMemo(() => buildTree(paths), [paths]);

  const onToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const onOpenFile = useCallback(
    async (path: string) => {
      await openWorkspaceFileInEditor(path, { workspaceId: workspaceId ?? undefined });
    },
    [workspaceId]
  );

  if (!workspacePath) {
    return (
      <p className="px-2 py-2 text-meta text-text-faint">Open a workspace to browse files.</p>
    );
  }

  if (loading && tree.length === 0) {
    return <p className="px-2 py-2 text-meta text-text-faint">Loading tree…</p>;
  }

  if (tree.length === 0) {
    return <p className="px-2 py-2 text-meta text-text-faint">No files found.</p>;
  }

  return (
    <div className="vx-dock-file-tree min-h-0 flex-1 overflow-y-auto px-1 pb-2">
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
}
