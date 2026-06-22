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
}

/** Persisted per-conversation task list (sidecar shape). */
export interface TaskList {
  /** Conversation this list belongs to. */
  conversationId: string;
  /** Ordered task items (index = priority). */
  items: TaskItem[];
  /** Epoch ms of the last write. */
  updatedAt: number;
}

/** Max items kept in a single list — guards against runaway agent writes. */
export const TASK_LIST_MAX_ITEMS = 100;
/** Max characters of a single task's content (trimmed beyond this). */
export const TASK_CONTENT_MAX_CHARS = 500;

const VALID_STATUSES = new Set<string>(TASK_STATUSES);

function coerceStatus(value: unknown): TaskStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value)
    ? (value as TaskStatus)
    : 'pending';
}

/**
 * Normalize an arbitrary array into a clean `TaskItem[]`:
 *   - drops non-object entries and entries with blank content,
 *   - trims + caps content length,
 *   - clamps unknown statuses to `pending`,
 *   - dedupes by id (first occurrence wins; later dupes are dropped),
 *   - mints a stable fallback id when one is missing,
 *   - enforces a single `in_progress` (later in_progress entries demote to
 *     `pending`) so the UI + agent contract ("one in_progress at a time")
 *     always holds,
 *   - caps the list length.
 *
 * Pure and side-effect free; safe to call on both the main and renderer side.
 * `idFactory` is injected so callers can supply a crypto-grade generator
 * (main) or a lightweight one (renderer) without this module importing either.
 */
export function normalizeTaskItems(
  input: unknown,
  idFactory: () => string
): TaskItem[] {
  if (!Array.isArray(input)) return [];
  const out: TaskItem[] = [];
  const seenIds = new Set<string>();
  let hasInProgress = false;

  for (const raw of input) {
    if (out.length >= TASK_LIST_MAX_ITEMS) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const candidate = raw as Partial<TaskItem>;
    const content =
      typeof candidate.content === 'string' ? candidate.content.trim() : '';
    if (content.length === 0) continue;

    let id =
      typeof candidate.id === 'string' && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : idFactory();
    // Guard against duplicate / colliding ids so React keys + merge-by-id
    // stay unambiguous.
    while (seenIds.has(id)) id = idFactory();
    seenIds.add(id);

    let status = coerceStatus(candidate.status);
    if (status === 'in_progress') {
      if (hasInProgress) status = 'pending';
      else hasInProgress = true;
    }

    out.push({
      id,
      content: content.slice(0, TASK_CONTENT_MAX_CHARS),
      status
    });
  }

  return out;
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

/**
 * Render a task list as a compact markdown checklist for the `<run_progress>`
 * context slot. Mirrors GFM checkbox semantics the model already understands.
 */
export function renderTaskListMarkdown(items: readonly TaskItem[]): string {
  if (items.length === 0) return '';
  const lines = items.map((item) => {
    switch (item.status) {
      case 'completed':
        return `- [x] ${item.content}`;
      case 'in_progress':
        return `- [ ] ${item.content} (in progress)`;
      case 'cancelled':
        return `- [~] ${item.content} (cancelled)`;
      case 'pending':
        return `- [ ] ${item.content}`;
      default: {
        const _exhaustive: never = item.status;
        void _exhaustive;
        return `- [ ] ${item.content}`;
      }
    }
  });
  const done = countCompleted(items);
  const active = items.filter((i) => i.status !== 'cancelled').length;
  return `Task plan (${done}/${active} done):\n${lines.join('\n')}`;
}
