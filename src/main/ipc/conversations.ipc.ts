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
// Audit fix 2026-06-P2-1 — id-and-title shape gates for the
// conversations channels. Conversation titles get a higher cap
// (sanitized at the store layer to 200 chars; the IPC gate accepts
// up to 2 KB to cover unicode + safety margin before the sanitizer
// trims it).
import { assertString, assertOptionalString } from './validate.js';

export function registerConversationsIpc(): void {
  // Optional `workspaceId` filter on `list` — used by the orchestrator's
  // `<prior_conversations>` envelope and the `recall` tool. The
  // renderer's dock chat strip always passes `undefined` so it gets the
  // full cross-workspace list and groups itself.
  wrapIpcHandler(
    IPC.CONVERSATIONS_LIST,
    async (_e, workspaceId?: string) => {
      assertOptionalString('conversations:list', 'workspaceId', workspaceId);
      return listConversations(workspaceId);
    }
  );
  wrapIpcHandler(IPC.CONVERSATIONS_READ, async (_e, id: string) => {
    assertString('conversations:read', 'id', id);
    return readConversation(id);
  });
  wrapIpcHandler(
    IPC.CONVERSATIONS_CREATE,
    async (_e, workspaceId: string) => {
      assertString('conversations:create', 'workspaceId', workspaceId);
      return createConversation(workspaceId);
    }
  );
  wrapIpcHandler(IPC.CONVERSATIONS_RENAME, async (_e, id: string, title: string) => {
    assertString('conversations:rename', 'id', id);
    // `title` is sanitized down to 200 chars at the store layer; allow
    // empty input so the renderer can route a "clear title" request
    // (the store collapses empty back to the default).
    assertString('conversations:rename', 'title', title, {
      nonEmpty: false,
      maxBytes: 2048
    });
    return renameConversation(id, title);
  });
  wrapIpcHandler(IPC.CONVERSATIONS_REMOVE, async (_e, id: string) => {
    assertString('conversations:remove', 'id', id);
    return removeConversation(id);
  });
  // Drag-between-workspaces. The store throws on unknown id / unknown
  // target workspace; the wrap layer surfaces the error to the renderer
  // so the sidebar can show a toast instead of silently swallowing it.
  wrapIpcHandler(
    IPC.CONVERSATIONS_MOVE,
    async (_e, id: string, targetWorkspaceId: string) => {
      assertString('conversations:move', 'id', id);
      assertString('conversations:move', 'targetWorkspaceId', targetWorkspaceId);
      return moveConversationToWorkspace(id, targetWorkspaceId);
    }
  );
}
