/**
 * Composer Stop must cancel idle summarization via `abortIdle`, not
 * the orchestrator-only `chat.abort` channel.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mintIdleSummaryRunId } from '@shared/contextSummary/idleSummaryRunId.js';
import { useChatStore } from '@renderer/store/useChatStore';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    runIdToModel: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: 'cA',
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
});

describe('useChatStore.abort (idle summarization)', () => {
  it('routes idle-summary runIds through contextSummary.abortIdle', async () => {
    const idleRunId = mintIdleSummaryRunId();
    useChatStore.setState({
      conversationId: 'cA',
      runId: idleRunId,
      isProcessing: true,
      slices: {
        cA: chatSliceFixture({
          conversationId: 'cA',
          runId: idleRunId,
          isProcessing: true,
          runStartedAt: 1
        })
      },
      runIdToConv: { [idleRunId]: 'cA' }
    });

    const abortIdle = vi.fn(async () => ({ ok: true }));
    const chatAbort = vi.fn(async () => undefined);
    window.vyotiq.contextSummary.abortIdle = abortIdle as never;
    window.vyotiq.chat.abort = chatAbort as never;

    await useChatStore.getState().abort();

    expect(abortIdle).toHaveBeenCalledWith('cA');
    expect(chatAbort).not.toHaveBeenCalled();
    expect(useChatStore.getState().isProcessing).toBe(false);
  });
});

describe('useChatStore.abortRun (idle summarization)', () => {
  it('routes idle-summary runIds through contextSummary.abortIdle', async () => {
    const idleRunId = mintIdleSummaryRunId();
    useChatStore.setState({
      slices: {
        cA: chatSliceFixture({
          conversationId: 'cA',
          runId: idleRunId,
          isProcessing: true
        })
      },
      runIdToConv: { [idleRunId]: 'cA' }
    });

    const abortIdle = vi.fn(async () => ({ ok: true }));
    const chatAbort = vi.fn(async () => undefined);
    window.vyotiq.contextSummary.abortIdle = abortIdle as never;
    window.vyotiq.chat.abort = chatAbort as never;

    await useChatStore.getState().abortRun(idleRunId);

    expect(abortIdle).toHaveBeenCalledWith('cA');
    expect(chatAbort).not.toHaveBeenCalled();
  });

  it('falls back to chat.abort when conversationId cannot be resolved', async () => {
    const idleRunId = mintIdleSummaryRunId();
    useChatStore.setState({
      conversationId: null,
      runId: idleRunId,
      isProcessing: true,
      runIdToConv: {}
    });

    const abortIdle = vi.fn(async () => ({ ok: true }));
    const chatAbort = vi.fn(async () => undefined);
    window.vyotiq.contextSummary.abortIdle = abortIdle as never;
    window.vyotiq.chat.abort = chatAbort as never;

    await useChatStore.getState().abort();

    expect(abortIdle).not.toHaveBeenCalled();
    expect(chatAbort).toHaveBeenCalledWith(idleRunId);
  });
});
