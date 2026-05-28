/**
 * `chat:abort` must cancel idle summarizer side-runs by synthetic runId.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_SUMMARY_RUN_ID_PREFIX } from '@shared/constants.js';

const abortRun = vi.fn();
const abortIdleSummaryByRunId = vi.fn(() => true);

vi.mock('@main/orchestrator/AgentV.js', () => ({
  abortRun: (...args: unknown[]) => abortRun(...args),
  listActiveRuns: vi.fn(() => []),
  findAllActiveRunsForConversation: vi.fn(() => []),
  startRun: vi.fn()
}));

vi.mock('@main/orchestrator/contextSummarizer/idleSummaryRuntime.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@main/orchestrator/contextSummarizer/idleSummaryRuntime.js')
  >();
  return {
    ...actual,
    abortIdleSummary: vi.fn(() => false),
    abortIdleSummaryByRunId: (...args: unknown[]) => abortIdleSummaryByRunId(...args),
    awaitIdleSummary: vi.fn(async () => undefined),
    hasIdleSummary: vi.fn(() => false)
  };
});

vi.mock('@main/conversations/conversationStore.js', () => ({
  appendEvent: vi.fn(),
  createConversation: vi.fn(),
  deriveTitleIfFresh: vi.fn(),
  drainAppendChain: vi.fn(async () => undefined),
  getConversationMeta: vi.fn(async () => ({ id: 'c1', workspaceId: 'ws-1', title: 't' })),
  readTranscript: vi.fn(async () => []),
  setLastModel: vi.fn()
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  getActiveWorkspace: vi.fn(async () => ({ id: 'ws-1', path: '/tmp', label: 'w', addedAt: 0 })),
  listWorkspaces: vi.fn(async () => ({ activeId: 'ws-1', workspaces: [] }))
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

vi.mock('@main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: vi.fn()
}));

vi.mock('@main/logging/logger.js', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}));

import { IPC } from '@shared/constants.js';

const mockIpc = (
  await import('electron')
).ipcMain as typeof import('electron').ipcMain & {
  __invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  __handlers: Map<string, (...args: unknown[]) => unknown>;
};

const { registerChatIpc } = await import('@main/ipc/chat.ipc.js');

beforeEach(() => {
  abortRun.mockClear();
  abortIdleSummaryByRunId.mockClear();
  mockIpc.__handlers.clear();
  registerChatIpc();
});

describe('chat:abort idle summarization', () => {
  it('routes idle-summary run ids to abortIdleSummaryByRunId', async () => {
    const idleRunId = `${IDLE_SUMMARY_RUN_ID_PREFIX}test-abc`;
    await mockIpc.__invoke(IPC.CHAT_ABORT, idleRunId);
    expect(abortIdleSummaryByRunId).toHaveBeenCalledWith(idleRunId);
    expect(abortRun).not.toHaveBeenCalled();
  });

  it('routes orchestrator run ids to abortRun', async () => {
    await mockIpc.__invoke(IPC.CHAT_ABORT, 'run-orchestrator-1');
    expect(abortRun).toHaveBeenCalledWith('run-orchestrator-1');
    expect(abortIdleSummaryByRunId).not.toHaveBeenCalled();
  });
});
