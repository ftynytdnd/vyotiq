/**
 * Task / todo types. A structured, per-conversation task list the agent
 * maintains via the `todos` tool and the user co-edits in the composer task
 * tray. Flows through IPC, the `todos-update` timeline event, and the
 * `<run_progress>` context slot.
 *
 * Kept in shared so main (tool + sidecar store + context builder), preload,
 * and renderer (store + tray UI) all agree on one shape. The normalizer is a
 * pure function reused on every write boundary so malformed agent or IPC
 * input can never corrupt the list.
 */

/** Lifecycle states for a single task. Terminal: `completed`, `cancelled`. */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/** Runtime catalogue of valid statuses — single source for validation. */
const TASK_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'cancelled'
] as const satisfies readonly TaskStatus[];

/** One entry in a task list. */
export interface TaskItem {
  /** Stable id (agent- or renderer-minted). Used for merge-by-id + UI keys. */
  id: string;
  /** Human-readable task description. List order is priority order. */
  content: string;
  /** Current lifecycle state. */
  status: TaskStatus;
  /** Omit or null = top-level main task. */
  parentId?: string | null;
}

/** Persisted per-conversation task list (sidecar shape). */
export interface TaskList {
  /** Conversation this list belongs to. */
  conversationId: string;
  /** Ordered task items (depth-first sibling order after normalize). */
  items: TaskItem[];
  /** Epoch ms of the last write. */
  updatedAt: number;
}

/** Max items kept in a single list — guards against runaway agent writes. */
export const TASK_LIST_MAX_ITEMS = 100;
/** Max characters of a single task's content (trimmed beyond this). */
export const TASK_CONTENT_MAX_CHARS = 500;

/** Nested tree node built from a flat `TaskItem[]` for UI rendering. */
export interface TaskTreeNode {
  item: TaskItem;
  depth: number;
  children: TaskTreeNode[];
}

const VALID_STATUSES = new Set<string>(TASK_STATUSES);

function coerceStatus(value: unknown): TaskStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value)
    ? (value as TaskStatus)
    : 'pending';
}

function coerceParentId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripParentId(item: TaskItem): TaskItem {
  const { parentId: _parentId, ...rest } = item;
  return rest;
}

function withParentId(item: TaskItem, parentId: string | null): TaskItem {
  if (parentId === null) return stripParentId(item);
  return { ...item, parentId };
}

/** Direct children of `parentId` in flat-array sibling order (`null` = roots). */
export function getTaskChildren(
  items: readonly TaskItem[],
  parentId: string | null
): TaskItem[] {
  return items.filter((item) => (item.parentId ?? null) === parentId);
}

/** Build a nested tree from a flat list (roots in array order). */
export function buildTaskTree(items: readonly TaskItem[]): TaskTreeNode[] {
  const walk = (parentId: string | null, depth: number): TaskTreeNode[] =>
    getTaskChildren(items, parentId).map((item) => ({
      item,
      depth,
      children: walk(item.id, depth + 1)
    }));
  return walk(null, 0);
}

/** Depth-first flatten of a task tree back to a flat array. */
export function flattenTaskTree(tree: readonly TaskTreeNode[]): TaskItem[] {
  const out: TaskItem[] = [];
  const walk = (nodes: readonly TaskTreeNode[]): void => {
    for (const node of nodes) {
      out.push(node.item);
      walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * Returns the id of a task whose parent chain loops, or null when acyclic.
 */
export function detectTaskCycle(items: readonly TaskItem[]): string | null {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    const seen = new Set<string>();
    let current: string | null = item.id;
    while (current) {
      if (seen.has(current)) return item.id;
      seen.add(current);
      const parentIdRaw: string | null | undefined = byId.get(current)?.parentId;
      const parentId: string | null =
        typeof parentIdRaw === 'string' && parentIdRaw.length > 0 ? parentIdRaw : null;
      if (!parentId || !byId.has(parentId)) break;
      current = parentId;
    }
  }
  return null;
}

/** All descendant ids of `rootId` (not including `rootId`). */
export function collectTaskDescendantIds(
  items: readonly TaskItem[],
  rootId: string
): Set<string> {
  const out = new Set<string>();
  const queue = getTaskChildren(items, rootId).map((c) => c.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of getTaskChildren(items, id)) queue.push(child.id);
  }
  return out;
}

/** True when `descendantId` is nested under `ancestorId`. */
export function isTaskDescendantOf(
  items: readonly TaskItem[],
  descendantId: string,
  ancestorId: string
): boolean {
  if (descendantId === ancestorId) return false;
  const byId = new Map(items.map((item) => [item.id, item]));
  let current: string | null = descendantId;
  while (current) {
    const parentIdRaw: string | null | undefined = byId.get(current)?.parentId;
    const parentId: string | null =
      typeof parentIdRaw === 'string' && parentIdRaw.length > 0 ? parentIdRaw : null;
    if (!parentId) return false;
    if (parentId === ancestorId) return true;
    current = parentId;
  }
  return false;
}

/** Promote orphans (missing parent) and break cycles by clearing parent links. */
function resolveParentLinks(items: TaskItem[]): TaskItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  let resolved = items.map((item) => {
    const parentId = item.parentId ?? null;
    if (parentId === null) return item;
    if (parentId === item.id || !byId.has(parentId)) {
      return withParentId(item, null);
    }
    return item;
  });

  for (;;) {
    const cycleId = detectTaskCycle(resolved);
    if (!cycleId) break;
    resolved = resolved.map((item) =>
      item.id === cycleId ? withParentId(item, null) : item
    );
  }

  return resolved;
}

/**
 * When all children of a parent are `completed`, mark the parent `completed`.
 * Never overrides explicit `cancelled`; does not auto-set `in_progress`.
 */
export function applyHybridParentStatus(items: readonly TaskItem[]): TaskItem[] {
  const byId = new Map(items.map((item) => [item.id, { ...item }]));
  const tree = buildTaskTree(items);

  const walk = (nodes: readonly TaskTreeNode[]): void => {
    for (const node of nodes) {
      walk(node.children);
      const children = getTaskChildren(items, node.item.id);
      if (children.length === 0) continue;
      const entry = byId.get(node.item.id);
      if (!entry || entry.status === 'cancelled') continue;
      const allChildrenDone = children.every(
        (c) => (byId.get(c.id) ?? c).status === 'completed'
      );
      if (allChildrenDone) entry.status = 'completed';
    }
  };

  walk(tree);
  return items.map((item) => byId.get(item.id) ?? item);
}

/** Leaf wins: demote in_progress ancestors when a descendant is also in_progress. */
function enforceLeafWinsInProgress(items: TaskItem[]): TaskItem[] {
  const inProgress = items.filter((item) => item.status === 'in_progress');
  if (inProgress.length <= 1) return items;

  const demoteIds = new Set<string>();
  for (const leaf of inProgress) {
    for (const other of inProgress) {
      if (leaf.id === other.id) continue;
      if (isTaskDescendantOf(items, leaf.id, other.id)) {
        demoteIds.add(other.id);
      }
    }
  }

  let next = items.map((item) =>
    demoteIds.has(item.id) && item.status === 'in_progress'
      ? { ...item, status: 'pending' as TaskStatus }
      : item
  );

  let seenInProgress = false;
  next = next.map((item) => {
    if (item.status !== 'in_progress') return item;
    if (seenInProgress) return { ...item, status: 'pending' as TaskStatus };
    seenInProgress = true;
    return item;
  });

  return next;
}

function orderTaskItemsDepthFirst(items: readonly TaskItem[]): TaskItem[] {
  return flattenTaskTree(buildTaskTree(items));
}

/**
 * Normalize an arbitrary array into a clean `TaskItem[]`:
 *   - drops non-object entries and entries with blank content,
 *   - trims + caps content length,
 *   - clamps unknown statuses to `pending`,
 *   - dedupes by id (first occurrence wins; later dupes are dropped),
 *   - mints a stable fallback id when one is missing,
 *   - resolves `parentId` (orphans promoted to root, cycles broken),
 *   - enforces a single `in_progress` (leaf wins over parent),
 *   - applies hybrid parent auto-completion,
 *   - reorders to depth-first sibling order,
 *   - caps the list length.
 */
export function normalizeTaskItems(
  input: unknown,
  idFactory: () => string
): TaskItem[] {
  if (!Array.isArray(input)) return [];
  const parsed: TaskItem[] = [];
  const seenIds = new Set<string>();

  for (const raw of input) {
    if (parsed.length >= TASK_LIST_MAX_ITEMS) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const candidate = raw as Partial<TaskItem>;
    const content =
      typeof candidate.content === 'string' ? candidate.content.trim() : '';
    if (content.length === 0) continue;

    let id =
      typeof candidate.id === 'string' && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : idFactory();
    while (seenIds.has(id)) id = idFactory();
    seenIds.add(id);

    const parentId = coerceParentId(candidate.parentId);
    const item: TaskItem = {
      id,
      content: content.slice(0, TASK_CONTENT_MAX_CHARS),
      status: coerceStatus(candidate.status),
      ...(parentId !== null ? { parentId } : {})
    };
    parsed.push(item);
  }

  if (parsed.length === 0) return [];

  const linked = resolveParentLinks(parsed);
  const inProgressResolved = enforceLeafWinsInProgress(linked);
  const hybrid = applyHybridParentStatus(inProgressResolved);
  return orderTaskItemsDepthFirst(hybrid);
}

/**
 * Merge an incoming patch into an existing list by id: existing items are
 * updated in place (preserving order), unknown ids are appended. Used by the
 * `todos` tool when `merge: true`. Returns a fresh normalized array.
 */
export function mergeTaskItems(
  existing: readonly TaskItem[],
  patch: readonly TaskItem[],
  idFactory: () => string
): TaskItem[] {
  const byId = new Map<string, TaskItem>();
  const order: string[] = [];
  for (const item of existing) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  for (const item of patch) {
    if (!byId.has(item.id)) order.push(item.id);
    byId.set(item.id, item);
  }
  const merged = order.map((id) => byId.get(id)).filter((x): x is TaskItem => Boolean(x));
  return normalizeTaskItems(merged, idFactory);
}

/** Count of tasks in a terminal `completed` state. */
export function countCompleted(items: readonly TaskItem[]): number {
  let n = 0;
  for (const item of items) if (item.status === 'completed') n += 1;
  return n;
}

/** Count of tasks that are not `cancelled` (pending, in_progress, or completed). */
export function countActiveTasks(items: readonly TaskItem[]): number {
  let n = 0;
  for (const item of items) if (item.status !== 'cancelled') n += 1;
  return n;
}

function formatTaskOutlineLine(number: string, item: TaskItem, depth: number): string {
  const indent = '  '.repeat(depth);
  const label = depth === 0 ? `${number}.` : number;
  switch (item.status) {
    case 'completed':
      return `${indent}${label} [x] ${item.content}`;
    case 'in_progress':
      return `${indent}${label} ${item.content} (in progress)`;
    case 'cancelled':
      return `${indent}${label} [~] ${item.content} (cancelled)`;
    case 'pending':
      return `${indent}${label} [ ] ${item.content}`;
    default: {
      const _exhaustive: never = item.status;
      void _exhaustive;
      return `${indent}${label} [ ] ${item.content}`;
    }
  }
}

function renderTaskTreeOutline(nodes: readonly TaskTreeNode[], prefix = ''): string[] {
  const lines: string[] = [];
  nodes.forEach((node, index) => {
    const number = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    lines.push(formatTaskOutlineLine(number, node.item, node.depth));
    lines.push(...renderTaskTreeOutline(node.children, number));
  });
  return lines;
}

/**
 * Render a task list as a numbered outline for the `<run_progress>` context slot.
 */
export function renderTaskListMarkdown(items: readonly TaskItem[]): string {
  if (items.length === 0) return '';
  const tree = buildTaskTree(items);
  const lines = renderTaskTreeOutline(tree);
  const done = countCompleted(items);
  const active = countActiveTasks(items);
  return `Task plan (${done}/${active} done):\n${lines.join('\n')}`;
}
