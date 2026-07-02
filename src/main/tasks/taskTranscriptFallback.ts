/**
 * Recover the latest structured task list from persisted transcript events
 * when the per-conversation sidecar is missing or empty.
 *
 * The sidecar remains the runtime source of truth; this path only hydrates
 * the composer task tray (and `tasks:get`) after sidecar loss while JSONL
 * still holds `todos-update` snapshots.
 */

import { randomUUID } from 'node:crypto';
import { readTranscript } from '../conversations/conversationStore.js';
import { normalizeTaskItems, type TaskItem } from '@shared/types/task.js';

/** Walk the transcript tail-first for the most recent `todos-update`. */
export async function readLastTodosFromTranscript(conversationId: string): Promise<TaskItem[]> {
  const events = await readTranscript(conversationId);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.kind === 'todos-update' && event.conversationId === conversationId) {
      return normalizeTaskItems(event.items, randomUUID);
    }
  }
  return [];
}
