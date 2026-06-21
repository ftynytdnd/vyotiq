/**
 * `injectDynamicLoopAudit` — host audit injection via follow-up plumbing.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createRunStateAccumulator } from '@main/orchestrator/loop/buildRunState.js';
import { createSpinSignatureBuffer } from '@main/orchestrator/loop/toolSpinSignature.js';
import type { ChatMessage } from '@shared/types/chat.js';
import { DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT } from '@main/orchestrator/loop/dynamicLoopAudit.js';

const injectFollowUpMock = vi.hoisted(() =>
  vi.fn(async () => ({
    userEnvelope: '<user_turn/>',
    promptEventId: 'evt-audit',
    query: DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT
  }))
);

vi.mock('@main/orchestrator/followUps/injectFollowUp.js', () => ({
  injectFollowUp: (...args: unknown[]) => injectFollowUpMock(...args)
}));

import { injectDynamicLoopAudit } from '@main/orchestrator/loop/dynamicLoopAudit.js';

function loopCtx(messages: ChatMessage[] = []) {
  return {
    runId: 'run-audit',
    conversationId: 'conv-audit',
    workspacePath: '/tmp/ws',
    workspaceId: 'ws-1',
    emit: vi.fn(),
    messages,
    runStateAcc: createRunStateAccumulator(),
    spin: createSpinSignatureBuffer(),
    signal: new AbortController().signal
  };
}

describe('injectDynamicLoopAudit', () => {
  beforeEach(() => {
    injectFollowUpMock.mockClear();
  });

  it('injects dynamic-loop sourced steering prompt', async () => {
    const selection = { providerId: 'p1', modelId: 'm1' };
    const result = await injectDynamicLoopAudit(loopCtx(), selection);
    expect(result).toEqual({
      query: DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT,
      selection
    });
    expect(injectFollowUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-audit',
        conversationId: 'conv-audit',
        followUp: expect.objectContaining({
          kind: 'steering',
          source: 'dynamic-loop',
          prompt: DEFAULT_DYNAMIC_LOOP_AUDIT_PROMPT,
          selection
        })
      })
    );
  });

  it('returns undefined without conversation id', async () => {
    const ctx = { ...loopCtx(), conversationId: '' };
    const result = await injectDynamicLoopAudit(ctx, { providerId: 'p', modelId: 'm' });
    expect(result).toBeUndefined();
    expect(injectFollowUpMock).not.toHaveBeenCalled();
  });
});
