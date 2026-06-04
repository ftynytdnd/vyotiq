/**
 * `chat:send` rejects a stale conversationId instead of silently creating a new chat.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';
import type { ChatSendInput } from '@shared/types/chat';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

vi.mock('@main/orchestrator/AgentV', () => ({
  startRun: vi.fn(async () => undefined),
  abortRun: vi.fn(),
  findAllActiveRunsForConversation: vi.fn(() => [])
}));

vi.mock('@main/window/getMainWindow', () => ({
  getMainWindow: () => ({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: vi.fn()
    }
  })
}));

const createConversation = vi.fn(async (workspaceId: string) => ({
  id: 'conv-auto',
  title: 'New',
  createdAt: 0,
  updatedAt: 0,
  eventCount: 0,
  workspaceId
}));

vi.mock('@main/conversations/conversationStore.js', () => ({
  appendEvent: vi.fn(async () => undefined),
  createConversation: (...args: unknown[]) => createConversation(...args),
  deriveTitleIfFresh: vi.fn(async () => undefined),
  drainAppendChain: vi.fn(async () => undefined),
  getConversationMeta: vi.fn(async (id: string) =>
    id === 'conv-known'
      ? {
          id,
          title: 'Known',
          createdAt: 0,
          updatedAt: 0,
          eventCount: 0,
          workspaceId: 'ws-test'
        }
      : null
  ),
  readTranscript: vi.fn(async () => []),
  setLastModel: vi.fn(async () => undefined)
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  getActiveWorkspace: vi.fn(async () => ({
    activeId: 'ws-test',
    workspaces: [{ id: 'ws-test', path: '/tmp/ws', label: 'ws', addedAt: 0 }]
  })),
  listWorkspaces: vi.fn(async () => [{ id: 'ws-test', path: '/tmp/ws', label: 'ws', addedAt: 0 }])
}));

vi.mock('@main/settings/settingsStore.js', () => ({
  getSettings: vi.fn(async () => ({ ui: {} }))
}));

const { registerChatIpc } = await import('@main/ipc/chat.ipc');

beforeEach(() => {
  vi.clearAllMocks();
  mockIpc.__handlers.clear();
  registerChatIpc();
});

const baseInput: ChatSendInput = {
  runId: 'run-1',
  prompt: 'hello',
  selection: { providerId: 'p', modelId: 'm' },
  permissions: { allowAuto: false },
  conversationId: 'conv-stale',
  workspaceId: 'ws-test'
};

describe('chat:send unknown conversationId', () => {
  it('returns structured refusal without creating a replacement conversation', async () => {
    const reply = await mockIpc.__invoke(IPC.CHAT_SEND, baseInput);
    expect(reply).toEqual({
      ok: false,
      kind: 'unknown-conversation',
      conversationId: 'conv-stale'
    });
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('still accepts a known conversationId', async () => {
    const reply = await mockIpc.__invoke(IPC.CHAT_SEND, {
      ...baseInput,
      conversationId: 'conv-known'
    });
    expect(reply).toEqual({ ok: true, conversationId: 'conv-known' });
  });
});
