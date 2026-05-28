import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunContextHandle } from '@main/orchestrator/runContextRegistry';
import {
  getRunContext,
  registerRunContext,
  unregisterRunContext
} from '@main/orchestrator/runContextRegistry';

function makeHandle(runId: string, abortSummary = vi.fn(() => false)): RunContextHandle {
  return {
    runId,
    generation: 0,
    conversationId: 'conv-1',
    workspaceId: 'ws-1',
    workspacePath: '/tmp/ws',
    messages: [],
    originalPrompt: 'hi',
    selection: { providerId: 'p', modelId: 'm' },
    rules: {
      enabled: true,
      triggerRatio: 0.8,
      keepRecentTurns: 4,
      maxRetries: 2,
      summarizerSelection: null
    },
    triggerManual: vi.fn(async () => ({ ok: false, reason: 'test' })),
    undo: vi.fn(async () => ({ ok: false })),
    snapshot: vi.fn(async () => ({
      messages: [],
      estimatedTokens: 0,
      systemPromptTokens: 0,
      rules: {
        enabled: true,
        triggerRatio: 0.8,
        keepRecentTurns: 4,
        maxRetries: 2,
        summarizerSelection: null
      },
      workspaceOverridePresent: false
    })),
    abortSummary
  };
}

describe('registerRunContext overwrite guard', () => {
  it('aborts the prior handle summarizer before overwriting', () => {
    const runId = `run-overwrite-${Date.now()}`;
    const abortPrior = vi.fn(() => true);
    registerRunContext(makeHandle(runId, abortPrior));
    const gen2 = registerRunContext(makeHandle(runId));
    expect(abortPrior).toHaveBeenCalledTimes(1);
    expect(getRunContext(runId)?.abortSummary).not.toBe(abortPrior);
    unregisterRunContext(runId, gen2);
  });
});
