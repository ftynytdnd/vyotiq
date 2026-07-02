/**
 * Pure helpers for the composer task tray tree — visibility, reorder, indent.
 */

import {
  buildTaskTree,
  collectTaskDescendantIds,
  flattenTaskTree,
  getTaskChildren,
  type TaskItem,
  type TaskTreeNode
} from '@shared/types/task.js';
import { DOCK_TREE_INDENT_PX } from '../../dock/dockFileTreeModel.js';

export { DOCK_TREE_INDENT_PX as TASK_TREE_INDENT_PX };

export interface VisibleTaskRow {
  item: TaskItem;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  siblingIndex: number;
  siblingCount: number;
}

export function flattenVisibleTaskRows(
  items: readonly TaskItem[],
  expandedSet: ReadonlySet<string>
): VisibleTaskRow[] {
  const rows: VisibleTaskRow[] = [];

  const walk = (nodes: readonly TaskTreeNode[]): void => {
    for (const node of nodes) {
      const hasChildren = node.children.length > 0;
      const isExpanded = !hasChildren || expandedSet.has(node.item.id);
      const siblings = getTaskChildren(items, node.item.parentId ?? null);
      rows.push({
        item: node.item,
        depth: node.depth,
        hasChildren,
        isExpanded,
        siblingIndex: siblings.findIndex((s) => s.id === node.item.id),
        siblingCount: siblings.length
      });
      if (hasChildren && isExpanded) walk(node.children);
    }
  };

  walk(buildTaskTree(items));
  return rows;
}

/** Expand ancestors of the current `in_progress` leaf (and all roots with children by default). */
export function defaultExpandedTaskIds(items: readonly TaskItem[]): Set<string> {
  const expanded = new Set<string>();
  const inProgress = items.find((t) => t.status === 'in_progress');
  if (!inProgress) {
    for (const item of items) {
      if (getTaskChildren(items, item.id).length > 0) expanded.add(item.id);
    }
    return expanded;
  }

  const byId = new Map(items.map((t) => [t.id, t]));
  let current: TaskItem | undefined = inProgress;
  while (current?.parentId && byId.has(current.parentId)) {
    expanded.add(current.parentId);
    current = byId.get(current.parentId);
  }

  for (const item of items) {
    if (collectTaskDescendantIds(items, item.id).has(inProgress.id)) {
      expanded.add(item.id);
    }
  }

  return expanded;
}

export function removeTaskWithDescendants(
  id: string,
  items: readonly TaskItem[]
): TaskItem[] {
  const removeIds = new Set([id, ...collectTaskDescendantIds(items, id)]);
  return items.filter((item) => !removeIds.has(item.id));
}

function reorderChildren(nodes: readonly TaskTreeNode[], id: string, direction: -1 | 1): TaskTreeNode[] {
  const idx = nodes.findIndex((n) => n.item.id === id);
  if (idx >= 0) {
    const target = idx + direction;
    if (target < 0 || target >= nodes.length) return [...nodes];
    const next = [...nodes];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    return next;
  }
  return nodes.map((node) => ({
    ...node,
    children: reorderChildren(node.children, id, direction)
  }));
}

/** Move a task up/down among its siblings (moves entire subtrees). */
export function moveTaskAmongSiblings(
  items: readonly TaskItem[],
  id: string,
  direction: -1 | 1
): TaskItem[] {
  const item = items.find((t) => t.id === id);
  if (!item) return [...items];
  const tree = buildTaskTree(items);
  const reordered = reorderChildren(tree, id, direction);
  return flattenTaskTree(reordered);
}

export function outdentTask(items: readonly TaskItem[], id: string): TaskItem[] {
  const item = items.find((t) => t.id === id);
  if (!item?.parentId) return [...items];
  const parent = items.find((t) => t.id === item.parentId);
  const nextParentId = parent?.parentId ?? null;
  return items.map((t) => {
    if (t.id !== id) return t;
    if (nextParentId === null) {
      const { parentId: _parentId, ...rest } = t;
      return rest;
    }
    return { ...t, parentId: nextParentId };
  });
}

/** Make `id` a child of the row immediately above in the visible list. */
export function indentTaskUsingPreviousRow(
  visibleRows: readonly VisibleTaskRow[],
  items: readonly TaskItem[],
  id: string
): TaskItem[] {
  const rowIdx = visibleRows.findIndex((r) => r.item.id === id);
  if (rowIdx <= 0) return [...items];
  const prev = visibleRows[rowIdx - 1]!;
  return items.map((t) => (t.id === id ? { ...t, parentId: prev.item.id } : t));
}

export function addSubTaskDraft(
  items: readonly TaskItem[],
  parentId: string,
  content: string,
  id: string
): TaskItem[] {
  return [
    ...items,
    {
      id,
      content,
      status: 'pending' as const,
      parentId
    }
  ];
}
