/**
 * Per-conversation task-list sidecar store.
 *
 * The structured task list is the single source of truth for the
 * `<run_progress>` context slot and the composer task tray. Each conversation
 * gets its own JSON file at `<userData>/vyotiq/tasks/<conversationId>.json` —
 * keyed by the globally-unique conversation id so lists never bleed across
 * chats (mirrors the per-conversation `run-progress` note isolation) and the
 * store never depends on which workspace is active.
 *
 * Writes are serialized per conversation (read-modify-write under a lock) so
 * a `todos` tool batch and a concurrent `tasks:set` user edit cannot clobber
 * each other. Reads are tolerant: a missing or corrupt file resolves to an
 * empty list rather than throwing into the orchestrator/context paths.
 */

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tasksDir } from '../paths/userDataLayout.js';
import {
  mergeTaskItems,
  normalizeTaskItems,
  renderTaskListMarkdown,
  type TaskItem,
  type TaskList
} from '@shared/types/task.js';

function idFactory(): string {
  return randomUUID();
}

/**
 * Conversation ids are UUIDs, but sanitize defensively so a malformed id can
 * never escape the tasks directory via path traversal.
 */
function sanitizeConversationId(conversationId: string): string {
  return conversationId.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120) || 'unknown';
}

function taskFilePath(conversationId: string): string {
  return join(tasksDir(), `${sanitizeConversationId(conversationId)}.json`);
}

/** Per-conversation write chain so concurrent writes serialize cleanly. */
const writeChains = new Map<string, Promise<unknown>>();

/**
 * Read the current task list for a conversation. Returns an empty (but
 * normalized) list when the file is missing or unreadable.
 */
export async function readTaskList(conversationId: string): Promise<TaskList> {
  const file = taskFilePath(conversationId);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TaskList>;
    return {
      conversationId,
      items: normalizeTaskItems(parsed.items, idFactory),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
    };
  } catch {
    return { conversationId, items: [], updatedAt: 0 };
  }
}

async function persist(conversationId: string, items: TaskItem[]): Promise<TaskList> {
  const dir = tasksDir();
  await fs.mkdir(dir, { recursive: true });
  const list: TaskList = { conversationId, items, updatedAt: Date.now() };
  const file = taskFilePath(conversationId);
  const tmp = `${file}.${process.pid}.tmp`;
  // Write-then-rename so a crash mid-write never leaves a half-written
  // JSON file that the tolerant reader would silently treat as empty.
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8');
  await fs.rename(tmp, file);
  return list;
}

/**
 * Serialize a read-modify-write transform for one conversation. The previous
 * write (success or failure) is awaited first so updates never interleave.
 */
function enqueueWrite(
  conversationId: string,
  transform: (current: TaskItem[]) => TaskItem[]
): Promise<TaskList> {
  const key = sanitizeConversationId(conversationId);
  const prior = writeChains.get(key) ?? Promise.resolve();
  const next = prior.then(async () => {
    const current = await readTaskList(conversationId);
    const nextItems = transform(current.items);
    return persist(conversationId, nextItems);
  });
  const tail: Promise<unknown> = next.catch(() => undefined);
  writeChains.set(key, tail);
  return next.finally(() => {
    if (writeChains.get(key) === tail) writeChains.delete(key);
  });
}

/**
 * Replace or merge the task list for a conversation.
 *   - `merge: false` (default) replaces the whole list with `items`.
 *   - `merge: true` updates existing items by id and appends new ones.
 * Always normalizes (dedupe, single in_progress, caps) before persisting.
 */
export async function writeTaskList(
  conversationId: string,
  items: readonly TaskItem[],
  merge: boolean
): Promise<TaskList> {
  return enqueueWrite(conversationId, (current) =>
    merge
      ? mergeTaskItems(current, normalizeTaskItems(items, idFactory), idFactory)
      : normalizeTaskItems(items, idFactory)
  );
}

/** Markdown checklist for the `<run_progress>` context slot (empty when none). */
export async function renderTaskListForContext(conversationId: string): Promise<string> {
  const list = await readTaskList(conversationId);
  return renderTaskListMarkdown(list.items);
}

/** Remove the sidecar when a conversation is deleted or pruned. */
export async function deleteTaskList(conversationId: string): Promise<void> {
  const key = sanitizeConversationId(conversationId);
  writeChains.delete(key);
  const file = taskFilePath(conversationId);
  try {
    await fs.unlink(file);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}
