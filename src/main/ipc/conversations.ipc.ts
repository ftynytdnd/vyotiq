/**
 * Conversations IPC. Exposes CRUD over persistent JSONL transcripts.
 *
 * Note: append is NOT exposed to the renderer. The main process owns
 * appends via `chat.ipc.ts` so streaming events don't pay an IPC round-trip
 * per token.
 */

import { dialog } from 'electron';
import { promises as fs } from 'node:fs';
import { IPC, TRANSCRIPT_PAGE_SIZE } from '@shared/constants.js';
import type {
  ConversationExportFormat,
  ConversationExportResult,
  TranscriptBeforeRead
} from '@shared/types/chat.js';
import type { TurnUsageStatsDelta } from '@shared/types/usageStats.js';
import type { ConversationSearchHit } from '@shared/types/ipc.js';
import { renderTranscriptMarkdown } from '@shared/transcript/exportMarkdown.js';
import {
  createConversation,
  incrementConversationSpend,
  listConversations,
  moveConversationToWorkspace,
  readConversation,
  readConversationTail,
  readTranscriptBefore,
  removeConversation,
  renameConversation,
  setConversationArchived
} from '../conversations/conversationStore.js';
import { searchPromptIndex } from '../conversations/conversationSearchIndex.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
// Audit fix 2026-06-P2-1 — id-and-title shape gates for the
// conversations channels. Conversation titles get a higher cap
// (sanitized at the store layer to 200 chars; the IPC gate accepts
// up to 2 KB to cover unicode + safety margin before the sanitizer
// trims it).
import { assertString, assertOptionalString, assertNumber } from './validate.js';

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
  // so the dock can show a toast instead of silently swallowing it.
  wrapIpcHandler(
    IPC.CONVERSATIONS_ARCHIVE,
    async (_e, id: string) => {
      assertString('conversations:archive', 'id', id);
      return setConversationArchived(id, true);
    }
  );
  wrapIpcHandler(
    IPC.CONVERSATIONS_UNARCHIVE,
    async (_e, id: string) => {
      assertString('conversations:unarchive', 'id', id);
      return setConversationArchived(id, false);
    }
  );
  wrapIpcHandler(
    IPC.CONVERSATIONS_MOVE,
    async (_e, id: string, targetWorkspaceId: string) => {
      assertString('conversations:move', 'id', id);
      assertString('conversations:move', 'targetWorkspaceId', targetWorkspaceId);
      return moveConversationToWorkspace(id, targetWorkspaceId);
    }
  );
  wrapIpcHandler(
    IPC.CONVERSATIONS_INCREMENT_SPEND,
    async (
      _e,
      id: string,
      promptId: string,
      usd: number,
      stats?: TurnUsageStatsDelta
    ) => {
      assertString('conversations:increment-spend', 'id', id);
      assertString('conversations:increment-spend', 'promptId', promptId);
      assertNumber('conversations:increment-spend', 'usd', usd, { min: 0, max: 1_000_000 });
      return incrementConversationSpend(id, promptId, usd, stats ?? {});
    }
  );

  wrapIpcHandler(
    IPC.CONVERSATIONS_READ_TAIL,
    async (_e, id: string, limit?: number) => {
      assertString('conversations:readTail', 'id', id);
      if (limit !== undefined) {
        assertNumber('conversations:readTail', 'limit', limit, { min: 1, max: 10_000 });
      }
      return readConversationTail(id, limit ?? TRANSCRIPT_PAGE_SIZE);
    }
  );

  wrapIpcHandler(
    IPC.CONVERSATIONS_READ_BEFORE,
    async (_e, id: string, beforeEventId: string, limit?: number): Promise<TranscriptBeforeRead> => {
      assertString('conversations:readBefore', 'id', id);
      assertString('conversations:readBefore', 'beforeEventId', beforeEventId);
      if (limit !== undefined) {
        assertNumber('conversations:readBefore', 'limit', limit, { min: 1, max: 10_000 });
      }
      const page = await readTranscriptBefore(id, beforeEventId, limit ?? TRANSCRIPT_PAGE_SIZE);
      return {
        events: page.events,
        hasOlder: page.hasOlder
      };
    }
  );

  wrapIpcHandler(
    IPC.CONVERSATIONS_EXPORT,
    async (_e, id: string, format: ConversationExportFormat): Promise<ConversationExportResult> => {
      assertString('conversations:export', 'id', id);
      if (format !== 'jsonl' && format !== 'markdown') {
        throw new Error(`conversations:export: invalid format "${String(format)}"`);
      }
      const conv = await readConversation(id);
      if (!conv) {
        throw new Error(`conversations:export: conversation not found (${id})`);
      }
      const safeTitle = conv.title.replace(/[<>:"/\\|?*]/g, '_').trim() || 'transcript';
      const defaultName =
        format === 'jsonl' ? `${safeTitle}.jsonl` : `${safeTitle}.md`;
      const filters =
        format === 'jsonl'
          ? [{ name: 'JSON Lines', extensions: ['jsonl'] }]
          : [{ name: 'Markdown', extensions: ['md'] }];
      const result = await dialog.showSaveDialog({
        title: 'Export conversation transcript',
        defaultPath: defaultName,
        filters
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }
      const body =
        format === 'jsonl'
          ? conv.events.map((e) => JSON.stringify(e)).join('\n') + '\n'
          : renderTranscriptMarkdown(conv.events, conv.title);
      await fs.writeFile(result.filePath, body, 'utf8');
      return { canceled: false, filePath: result.filePath };
    }
  );

  wrapIpcHandler(
    IPC.CONVERSATIONS_SEARCH,
    async (_e, workspaceId: string, query: string, limit?: number): Promise<ConversationSearchHit[]> => {
      assertString('conversations:search', 'workspaceId', workspaceId);
      assertString('conversations:search', 'query', query, { maxBytes: 512 });
      if (limit !== undefined) {
        assertNumber('conversations:search', 'limit', limit, { min: 1, max: 50 });
      }
      const q = query.trim();
      if (!q) return [];
      const entries = await searchPromptIndex(workspaceId, q, limit ?? 20);
      if (entries.length === 0) return [];
      const metas = await listConversations();
      const titleById = new Map(metas.map((m) => [m.id, m.title]));
      return entries.map((entry) => ({
        conversationId: entry.conversationId,
        eventId: entry.eventId,
        workspaceId: entry.workspaceId,
        excerpt: entry.excerpt,
        ts: entry.ts,
        conversationTitle: titleById.get(entry.conversationId) ?? 'Untitled'
      }));
    }
  );
}
