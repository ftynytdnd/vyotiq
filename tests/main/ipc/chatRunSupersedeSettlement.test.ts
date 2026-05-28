/**
 * `chat:send` supersede awaits prior run settlement before `readTranscript`.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const abortRun = vi.fn();
const findAllActiveRunsForConversation = vi.fn(() => ['prior-run']);
const startRun = vi.fn(async () => undefined);
const drainAppendChain = vi.fn(async () => undefined);
const readTranscript = vi.fn(async () => [{ kind: 'user-prompt', id: 'p1', ts: 0, content: 'hi' }]);

const awaitRunSettlement = vi.fn(async () => undefined);
const armRunSettlement = vi.fn();
const settleRun = vi.fn();

vi.mock('@main/ipc/runSettlement.js', () => ({
  awaitRunSettlement: (...args: unknown[]) => awaitRunSettlement(...args),
  armRunSettlement: (...args: unknown[]) => armRunSettlement(...args),
  settleRun: (...args: unknown[]) => settleRun(...args)
}));

vi.mock('@main/orchestrator/contextSummarizer/idleSummaryRuntime.js', () => ({
  abortIdleSummary: vi.fn(() => false),
  awaitIdleSummary: vi.fn(async () => undefined),
  hasIdleSummary: vi.fn(() => false),
  abortIdleSummaryByRunId: vi.fn()
}));

vi.mock('@main/orchestrator/AgentV', () => ({
  startRun: (...args: unknown[]) => startRun(...args),
  abortRun: (...args: unknown[]) => abortRun(...args),
  findAllActiveRunsForConversation: (...args: unknown[]) =>
    findAllActiveRunsForConversation(...args),
  listActiveRuns: vi.fn(() => [])
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
  createConversation: vi.fn(async () => ({
    id: 'conv-new',
    title: 'New conversation',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    workspaceId: 'ws-1'
  })),
  deriveTitleIfFresh: vi.fn(async () => undefined),
  drainAppendChain: (...args: unknown[]) => drainAppendChain(...args),
  getConversationMeta: vi.fn(async (id: string) => ({
    id,
    title: 't',
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    workspaceId: 'ws-1'
  })),
  readTranscript: (...args: unknown[]) => readTranscript(...args),
  setLastModel: vi.fn(async () => undefined)
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  getActiveWorkspace: vi.fn(async () => ({
    activeId: 'ws-1',
    workspaces: [{ id: 'ws-1', path: '/tmp/ws', label: 'WS', addedAt: 0 }]
  })),
  requireWorkspaceById: vi.fn(async () => '/tmp/ws'),
  listWorkspaces: vi.fn(async () => ({
    activeId: 'ws-1',
    workspaces: [{ id: 'ws-1', path: '/tmp/ws', label: 'WS', addedAt: 0 }]
  }))
}));

vi.mock('@main/checkpoints/index.js', () => ({
  acceptAll: vi.fn(),
  listPending: vi.fn(async () => [])
}));

vi.mock('@main/checkpoints/reviewSessions.js', () => ({
  getReviewSession: vi.fn(async () => null),
  reviewSessionBlocksSend: vi.fn(() => false)
}));

vi.mock('@main/settings/settingsStore.js', () => ({
  getSettings: vi.fn(async () => ({ ui: {} }))
}));

const { registerChatIpc } = await import('@main/ipc/chat.ipc');

describe('registerChatIpc — run supersede settlement', () => {
  beforeEach(() => {
    abortRun.mockClear();
    findAllActiveRunsForConversation.mockClear();
    startRun.mockClear();
    drainAppendChain.mockClear();
    readTranscript.mockClear();
    awaitRunSettlement.mockClear();
    armRunSettlement.mockClear();
    settleRun.mockClear();
    mockIpc.__handlers.clear();
    registerChatIpc();
  });

  it('awaits run settlement before readTranscript when superseding', async () => {
    const order: string[] = [];
    awaitRunSettlement.mockImplementation(async () => {
      order.push('await-settlement');
    });
    drainAppendChain.mockImplementation(async () => {
      order.push('drain');
    });
    readTranscript.mockImplementation(async () => {
      order.push('read');
      return [];
    });
    startRun.mockImplementation(async () => {
      order.push('start');
    });

    await mockIpc.__invoke(IPC.CHAT_SEND, {
      runId: 'run-new',
      conversationId: 'conv-1',
      workspaceId: 'ws-1',
      prompt: 'next',
      selection: { providerId: 'p1', modelId: 'm1' },
      permissions: { allowAuto: true }
    });

    expect(abortRun).toHaveBeenCalledWith('prior-run');
    expect(awaitRunSettlement).toHaveBeenCalledWith('conv-1');
    expect(order.indexOf('await-settlement')).toBeLessThan(order.indexOf('read'));
    expect(order.indexOf('drain')).toBeLessThan(order.indexOf('read'));
    expect(armRunSettlement).toHaveBeenCalledWith('conv-1');
  });
});
