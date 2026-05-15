/**
 * Conversations IPC. Exposes CRUD over persistent JSONL transcripts.
 *
 * Note: append is NOT exposed to the renderer. The main process owns
 * appends via `chat.ipc.ts` so streaming events don't pay an IPC round-trip
 * per token.
 */

import { IPC } from '@shared/constants.js';
import {
  createConversation,
  listConversations,
  moveConversationToWorkspace,
  readConversation,
  removeConversation,
  renameConversation
} from '../conversations/conversationStore.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';

export function registerConversationsIpc(): void {
  // Optional `workspaceId` filter on `list` — used by the orchestrator's
  // `<prior_conversations>` envelope and the `recall` tool. The
  // renderer's sidebar tree always passes `undefined` so it gets the
  // full cross-workspace list and groups itself.
  wrapIpcHandler(
    IPC.CONVERSATIONS_LIST,
    async (_e, workspaceId?: string) => listConversations(workspaceId)
  );
  wrapIpcHandler(IPC.CONVERSATIONS_READ, async (_e, id: string) => readConversation(id));
  wrapIpcHandler(
    IPC.CONVERSATIONS_CREATE,
    async (_e, workspaceId: string) => createConversation(workspaceId)
  );
  wrapIpcHandler(IPC.CONVERSATIONS_RENAME, async (_e, id: string, title: string) =>
    renameConversation(id, title)
  );
  wrapIpcHandler(IPC.CONVERSATIONS_REMOVE, async (_e, id: string) => removeConversation(id));
  // Drag-between-workspaces. The store throws on unknown id / unknown
  // target workspace; the wrap layer surfaces the error to the renderer
  // so the sidebar can show a toast instead of silently swallowing it.
  wrapIpcHandler(
    IPC.CONVERSATIONS_MOVE,
    async (_e, id: string, targetWorkspaceId: string) =>
      moveConversationToWorkspace(id, targetWorkspaceId)
  );
}
