/**
 * Tasks IPC. The renderer reads and writes the per-conversation structured
 * task list shown in the composer task tray.
 *
 *   - `tasks:get`  — read the current list for a conversation.
 *   - `tasks:set`  — persist a user-edited list (replace) and return the
 *                    normalized result.
 *
 * The sidecar (`src/main/tasks/taskStore.ts`) is the single source of truth:
 * the agent's `todos` tool, the `<run_progress>` context slot, and this IPC all
 * read/write the same file. User edits land here; the editing renderer updates
 * optimistically from the returned list, and any later reopen rehydrates via
 * `tasks:get`. Agent-side writes additionally emit a `todos-update` timeline
 * event (persisted + live) through the orchestrator emit path.
 */

import { randomUUID } from 'node:crypto';
import { IPC } from '@shared/constants.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import type { TaskList } from '@shared/types/task.js';
import { TASK_LIST_MAX_ITEMS } from '@shared/types/task.js';
import { appendEvent } from '../conversations/conversationStore.js';
import { readTaskList, writeTaskList } from '../tasks/taskStore.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertString } from './validate.js';
import { logger } from '../logging/logger.js';

const log = logger.child('ipc/tasks');

function emitTodosUpdate(conversationId: string, items: TaskList['items']): void {
  const event: TimelineEvent = {
    kind: 'todos-update',
    id: randomUUID(),
    ts: Date.now(),
    conversationId,
    items
  };
  void appendEvent(conversationId, event).catch((err: unknown) => {
    log.warn('appendEvent failed during tasks:set', {
      conversationId,
      err: err instanceof Error ? err.message : String(err)
    });
  });
  safeWebContentsSend(IPC.CHAT_EVENT, `manual:${conversationId}`, event);
}

export function registerTasksIpc(): void {
  wrapIpcHandler(IPC.TASKS_GET, async (_event, conversationId: string): Promise<TaskList> => {
    assertString('tasks:get', 'conversationId', conversationId);
    return readTaskList(conversationId);
  });

  wrapIpcHandler(
    IPC.TASKS_SET,
    async (_event, conversationId: string, items: unknown): Promise<TaskList> => {
      assertString('tasks:set', 'conversationId', conversationId);
      if (!Array.isArray(items)) {
        throw new Error('tasks:set: items must be an array');
      }
      if (items.length > TASK_LIST_MAX_ITEMS) {
        throw new Error(
          `tasks:set: items exceeds the ${TASK_LIST_MAX_ITEMS} item cap (received ${items.length})`
        );
      }
      // `writeTaskList` normalizes defensively (dedupe, single in_progress,
      // content caps), so a malformed entry can never corrupt the sidecar.
      const list = await writeTaskList(conversationId, items as TaskList['items'], false);
      emitTodosUpdate(conversationId, list.items);
      return list;
    }
  );
}
