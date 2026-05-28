/**
 * `chat:send` review request_changes gate.
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

vi.mock('@main/orchestrator/contextSummarizer/idleSummaryRuntime.js', () => ({
  abortIdleSummary: vi.fn(() => false),
  awaitIdleSummary: vi.fn(async () => undefined),
  hasIdleSummary: vi.fn(() => false)
}));

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

vi.mock('@main/conversations/conversationStore.js', () => ({
  appendEvent: vi.fn(async () => undefined),
  createConversation: vi.fn(),
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
  listWorkspaces: vi.fn(async () => ({
    workspaces: [{ id: 'ws-test', path: '/tmp/ws', label: 'ws', addedAt: 0 }]
  }))
}));

vi.mock('@main/checkpoints/index.js', () => ({
  listPending: vi.fn(async () => []),
  acceptAll: vi.fn(async () => 0)
}));

const reviewSessionBlocksSend = vi.fn(async () => false);

vi.mock('@main/checkpoints/reviewSessions.js', () => ({
  reviewSessionBlocksSend: (...args: unknown[]) => reviewSessionBlocksSend(...args)
}));

const getSettings = vi.fn(async () => ({
  ui: { gatePromptOnReviewRequestChangesByWorkspace: { 'ws-test': true } }
}));

vi.mock('@main/settings/settingsStore.js', () => ({
  getSettings: (...args: unknown[]) => getSettings(...args)
}));

const { registerChatIpc } = await import('@main/ipc/chat.ipc');
const { startRun } = await import('@main/orchestrator/AgentV');

beforeEach(() => {
  vi.clearAllMocks();
  mockIpc.__handlers.clear();
  getSettings.mockResolvedValue({
    ui: { gatePromptOnReviewRequestChangesByWorkspace: { 'ws-test': true } }
  });
  reviewSessionBlocksSend.mockResolvedValue(false);
  registerChatIpc();
});

const baseInput: ChatSendInput = {
  runId: 'run-1',
  prompt: 'hello',
  selection: { providerId: 'p', modelId: 'm' },
  permissions: { allowAuto: false },
  conversationId: 'conv-known',
  workspaceId: 'ws-test'
};

describe('chat:send review request_changes gate', () => {
  it('blocks send when gate is on and session has request_changes', async () => {
    reviewSessionBlocksSend.mockResolvedValueOnce(true);

    const reply = await mockIpc.__invoke(IPC.CHAT_SEND, baseInput);

    expect(reply).toEqual({
      ok: false,
      kind: 'review-request-changes',
      conversationId: 'conv-known'
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it('blocks send when gate is on and reviewSessionBlocksSend throws', async () => {
    reviewSessionBlocksSend.mockRejectedValueOnce(new Error('reviews unreadable'));

    const reply = await mockIpc.__invoke(IPC.CHAT_SEND, baseInput);

    expect(reply).toEqual({
      ok: false,
      kind: 'review-gate-error',
      conversationId: 'conv-known'
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it('allows send when gate is off even if session would block', async () => {
    getSettings.mockResolvedValueOnce({
      ui: { gatePromptOnReviewRequestChangesByWorkspace: { 'ws-test': false } }
    });
    reviewSessionBlocksSend.mockResolvedValueOnce(true);

    const reply = await mockIpc.__invoke(IPC.CHAT_SEND, baseInput);

    expect(reply).toEqual({ ok: true, conversationId: 'conv-known' });
    expect(reviewSessionBlocksSend).not.toHaveBeenCalled();
    expect(startRun).toHaveBeenCalled();
  });
});
