/**
 * conversations:search IPC validation and mapping.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const searchPromptIndex = vi.fn(async () => [
  {
    conversationId: 'conv-1',
    eventId: 'evt-1',
    workspaceId: 'ws-1',
    excerpt: 'hello world',
    ts: 1_700_000_000_000
  }
]);

const listConversations = vi.fn(async () => [
  { id: 'conv-1', title: 'Demo chat', workspaceId: 'ws-1', updatedAt: 1, createdAt: 1 }
]);

vi.mock('@main/conversations/conversationSearchIndex.js', () => ({
  searchPromptIndex: (...args: unknown[]) => searchPromptIndex(...args)
}));

vi.mock('@main/conversations/conversationStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/conversations/conversationStore.js')>();
  return {
    ...actual,
    listConversations: (...args: unknown[]) => listConversations(...args)
  };
});

beforeEach(async () => {
  searchPromptIndex.mockClear();
  listConversations.mockClear();
  mockIpc.__handlers.clear();
  const { registerConversationsIpc } = await import('@main/ipc/conversations.ipc.js');
  registerConversationsIpc();
});

describe('conversations:search IPC', () => {
  it('returns mapped hits for a trimmed query', async () => {
    const hits = await mockIpc.__invoke(IPC.CONVERSATIONS_SEARCH, 'ws-1', 'hello', 10);
    expect(searchPromptIndex).toHaveBeenCalledWith('ws-1', 'hello', 10);
    expect(hits).toEqual([
      {
        conversationId: 'conv-1',
        eventId: 'evt-1',
        workspaceId: 'ws-1',
        excerpt: 'hello world',
        ts: 1_700_000_000_000,
        conversationTitle: 'Demo chat'
      }
    ]);
  });

  it('returns empty array for blank query without searching', async () => {
    const hits = await mockIpc.__invoke(IPC.CONVERSATIONS_SEARCH, 'ws-1', '   ');
    expect(hits).toEqual([]);
    expect(searchPromptIndex).not.toHaveBeenCalled();
  });

  it('rejects limit above 50', async () => {
    await expect(
      mockIpc.__invoke(IPC.CONVERSATIONS_SEARCH, 'ws-1', 'q', 51)
    ).rejects.toThrow(/limit/);
  });
});
