/**
 * Pins two contracts that are easy to break by accident:
 *
 *   1. `ProviderError` flows through the SAME 3-strike retry path as
 *      generic transport failures. A 402 billing error MUST NOT short-
 *      circuit the loop — the user explicitly opted to keep the
 *      existing retry behavior unchanged.
 *
 *   2. The amber `agent-thought` painted on each strike now carries
 *      `error.friendlyMessage` (e.g. "Insufficient balance. Top up …")
 *      instead of the raw `POST … 402 Payment Required` dump.
 *
 * Mocks `handleAssistantTurn` (single source of streaming behavior per
 * the audit) so the test drives the runLoop's error branch directly,
 * mirroring the pattern in the sibling `runLoop.test.ts` suite.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { ProviderError } from '@main/providers/providerError';
import { MAX_SELF_CORRECTION_ATTEMPTS } from '@shared/constants';

vi.mock('@main/orchestrator/loop/handleAssistantTurn', () => ({
  handleAssistantTurn: vi.fn()
}));
vi.mock('@main/orchestrator/contextManager', async () => {
  const real = await vi.importActual<
    typeof import('@main/orchestrator/contextManager')
  >('@main/orchestrator/contextManager');
  return {
    ...real,
    refreshEnvelopes: vi.fn(async () => ({
      workspaceXml: '<workspace_context>stub</workspace_context>',
      sessionXml: '<session_context>stub</session_context>',
      memoryXml: '<recent_memory>stub</recent_memory>',
      metaRulesXml: '<meta_rules>stub</meta_rules>'
    }))
  };
});
vi.mock('@main/harness/harnessLoader', () => ({
  buildOrchestratorSystemPrompt: () => '<system_instructions>stub</system_instructions>'
}));
vi.mock('@main/orchestrator/retry', async () => {
  const real = await vi.importActual<typeof import('@main/orchestrator/retry')>(
    '@main/orchestrator/retry'
  );
  return {
    ...real,
    backoff: vi.fn(async (_attempt: number, opts?: { signal?: AbortSignal }) => {
      if (opts?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
    })
  };
});
vi.mock('@main/orchestrator/loop/buildOrchestratorRequest', () => ({
  buildOrchestratorRequest: vi.fn((opts: {
    selection: { providerId: string; modelId: string };
    messages: unknown;
    signal: AbortSignal;
  }) => ({
    providerId: opts.selection.providerId,
    model: opts.selection.modelId,
    messages: opts.messages,
    signal: opts.signal
  }))
}));

import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';
import { runOrchestratorLoop } from '@main/orchestrator/loop/runLoop';

beforeEach(() => {
  vi.mocked(handleAssistantTurn).mockReset();
});

const baseInput = {
  runId: 'run-pe',
  prompt: 'hi',
  selection: { providerId: 'p', modelId: 'm' },
  permissions: { allowFileWrites: false, allowBash: false, allowWebSearch: false }
} as const;

describe('runOrchestratorLoop — ProviderError handling', () => {
  it('still retries 3 times for a billing error (retry policy unchanged)', async () => {
    const billing = new ProviderError({
      kind: 'billing',
      status: 402,
      providerId: 'p',
      providerName: 'DeepSeek',
      friendlyMessage: 'DeepSeek: Insufficient balance. Top up at your provider dashboard.',
      surface: 'chat',
      rawBody: '{"error":{"message":"Insufficient Balance"}}'
    });

    vi.mocked(handleAssistantTurn).mockResolvedValue({
      assistantMsgId: 'msg-pe',
      assistantText: '',
      reasoningText: '',
      partialToolCalls: [],
      hadText: false,
      hadReasoning: false,
      reasoningEndEmitted: false,
      error: billing
    });

    const ctrl = new AbortController();
    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-pe' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: ctrl.signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      permissions: baseInput.permissions,
      strictApprovals: false
    });

    // Three full attempts before escalation — the constant is the
    // single source of truth, so this assertion catches accidental
    // changes to retry policy too.
    expect(handleAssistantTurn).toHaveBeenCalledTimes(MAX_SELF_CORRECTION_ATTEMPTS);

    // Final verdict is a single error event after the budget runs out.
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    // The error message ends in the FRIENDLY copy (so the user sees
    // "Insufficient balance. Top up …", not the raw 402 dump).
    expect((errors[0] as { message: string }).message).toMatch(/Insufficient balance/);
  });

  it('paints friendlyMessage in the amber retry-warning thought', async () => {
    const auth = new ProviderError({
      kind: 'auth',
      status: 401,
      providerId: 'p',
      providerName: 'OpenAI',
      friendlyMessage: 'OpenAI: Authentication failed. Check the API key in Settings → Providers.',
      surface: 'chat',
      rawBody: '{"error":{"message":"Invalid API key"}}'
    });

    vi.mocked(handleAssistantTurn).mockResolvedValueOnce({
      assistantMsgId: 'msg-1',
      assistantText: '',
      reasoningText: '',
      partialToolCalls: [],
      hadText: false,
      hadReasoning: false,
      reasoningEndEmitted: false,
      error: auth
    });
    // Stop the loop after one strike so we can observe the FIRST
    // amber thought without burning the whole budget. The second
    // call returns a clean text turn that terminates.
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce({
      assistantMsgId: 'msg-2',
      assistantText: 'Recovered.',
      reasoningText: '',
      partialToolCalls: [],
      hadText: true,
      hadReasoning: false,
      reasoningEndEmitted: false
    });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-pe' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      permissions: baseInput.permissions,
      strictApprovals: false
    });

    const warnThought = events.find(
      (e) => e.kind === 'agent-thought' && (e as { severity?: string }).severity === 'warn'
    ) as { content: string } | undefined;
    expect(warnThought?.content).toMatch(/Authentication failed/);
    // Critically NOT the raw response body:
    expect(warnThought?.content ?? '').not.toContain('Invalid API key');
  });
});
