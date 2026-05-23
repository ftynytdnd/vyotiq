/**
 * `chat:send` supersede path for in-flight idle summarization.
 *
 * When a user sends a new prompt while an idle summary is streaming,
 * the IPC handler must abort + await settlement + drain the append
 * chain before reading the transcript for the next run.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const abortIdleSummaryFor = vi.fn(() => true);
const awaitIdleSummaryFor = vi.fn(async () => undefined);
const hasIdleSummaryFor = vi.fn(() => true);
const drainAppendChain = vi.fn(async () => undefined);
const readTranscript = vi.fn(async () => []);

vi.mock('@main/orchestrator/contextSummarizer/idleSummaryRuntime.js', () => ({
  abortIdleSummary: (...args: unknown[]) => abortIdleSummaryFor(...args),
  awaitIdleSummary: (...args: unknown[]) => awaitIdleSummaryFor(...args),
  hasIdleSummary: (...args: unknown[]) => hasIdleSummaryFor(...args)
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
  requireWorkspaceById: vi.fn(async () => '/tmp/ws')
}));

const { registerChatIpc } = await import('@main/ipc/chat.ipc');

describe('registerChatIpc — idle summary supersede on chat:send', () => {
  beforeEach(() => {
    abortIdleSummaryFor.mockClear();
    awaitIdleSummaryFor.mockClear();
    hasIdleSummaryFor.mockClear();
    drainAppendChain.mockClear();
    readTranscript.mockClear();
    hasIdleSummaryFor.mockReturnValue(true);
    mockIpc.__handlers.clear();
    registerChatIpc();
  });

  it('aborts, awaits, and drains before starting a new run when idle summary is in flight', async () => {
    await mockIpc.__invoke(IPC.CHAT_SEND, {
      runId: 'run-new',
      conversationId: 'conv-1',
      workspaceId: 'ws-1',
      prompt: 'next prompt',
      selection: { providerId: 'p1', modelId: 'm1' },
      permissions: { allowAuto: false }
    });

    expect(hasIdleSummaryFor).toHaveBeenCalledWith('conv-1');
    expect(abortIdleSummaryFor).toHaveBeenCalledWith('conv-1');
    expect(awaitIdleSummaryFor).toHaveBeenCalledWith('conv-1');
    expect(drainAppendChain).toHaveBeenCalledWith('conv-1');
    expect(readTranscript).toHaveBeenCalledWith('conv-1');
  });
});
