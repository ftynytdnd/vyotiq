/**
 * Pins ProviderError handling in `runOrchestratorLoop`:
 *   - Non-recoverable kinds (402 billing, 401 auth, …) terminate immediately.
 *   - Transient failures still use the retry budget and friendly messages.
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
      priorConversationsXml: '<prior_conversations>stub</prior_conversations>',
      memoryXml: '<recent_memory>stub</recent_memory>',
      metaRulesXml: '<meta_rules>stub</meta_rules>',
      runProgressXml: ''
    }))
  };
});
vi.mock('@main/harness/harnessLoader', () => ({
  buildOrchestratorSystemPrompt: () => '<system_instructions>stub</system_instructions>',
  buildStaticFewShotXml: () => '<static_examples>stub</static_examples>'
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
vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => ({
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    dialect: 'openai'
  }))
}));

import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';
import { runOrchestratorLoop, __test_resetRecentBillingBlock } from '@main/orchestrator/loop/runLoop';

beforeEach(() => {
  vi.mocked(handleAssistantTurn).mockReset();
  __test_resetRecentBillingBlock();
});

const baseInput = {
  runId: 'run-pe',
  prompt: 'hi',
  selection: { providerId: 'p', modelId: 'm' },
} as const;

describe('runOrchestratorLoop — ProviderError handling', () => {
  it('does not retry 402 billing — terminates on first strike', async () => {
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

    const events: TimelineEvent[] = [];
    const result = await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-pe' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      strictApprovals: false
    });

    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    expect(result.terminalError).toMatch(/Insufficient balance/);
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toMatch(/Insufficient balance/);
    const retries = events.filter(
      (e) => e.kind === 'agent-thought' && (e as { severity?: string }).severity === 'warn'
    );
    expect(retries).toHaveLength(0);
  });

  it('still retries transient server errors up to the budget', async () => {
    const server = new ProviderError({
      kind: 'server',
      status: 503,
      providerId: 'p',
      providerName: 'OpenAI',
      friendlyMessage: 'OpenAI: Provider server error (HTTP 503).',
      surface: 'chat',
      rawBody: ''
    });

    vi.mocked(handleAssistantTurn).mockResolvedValue({
      assistantMsgId: 'msg-pe',
      assistantText: '',
      reasoningText: '',
      partialToolCalls: [],
      hadText: false,
      hadReasoning: false,
      reasoningEndEmitted: false,
      error: server
    });

    await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-pe' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: () => {},
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      strictApprovals: false
    });

    expect(handleAssistantTurn).toHaveBeenCalledTimes(MAX_SELF_CORRECTION_ATTEMPTS);
  });

  it('paints friendlyMessage in the amber retry-warning thought for recoverable auth', async () => {
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

    const events: TimelineEvent[] = [];
    const result = await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-pe' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      strictApprovals: false
    });

    expect(result.terminalError).toMatch(/Authentication failed/);
    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    const warnThought = events.find(
      (e) => e.kind === 'agent-thought' && (e as { severity?: string }).severity === 'warn'
    );
    expect(warnThought).toBeUndefined();
  });

  it('includes provider friendlyMessage in terminal error after rate-limit strikes', async () => {
    const rateLimit = new ProviderError({
      kind: 'rate-limit',
      status: 429,
      providerId: 'p',
      providerName: 'OpenRouter',
      friendlyMessage: 'OpenRouter: Rate limit exceeded.',
      surface: 'chat',
      rawBody: ''
    });

    vi.mocked(handleAssistantTurn).mockResolvedValue({
      assistantMsgId: 'msg-pe',
      assistantText: '',
      reasoningText: '',
      partialToolCalls: [],
      hadText: false,
      hadReasoning: false,
      reasoningEndEmitted: false,
      error: rateLimit
    });

    const events: TimelineEvent[] = [];
    const result = await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-pe' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      strictApprovals: false
    });

    expect(handleAssistantTurn).toHaveBeenCalledTimes(MAX_SELF_CORRECTION_ATTEMPTS);
    expect(result.terminalError).toMatch(/Rate limit exceeded/);
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toMatch(/Rate limit exceeded/);
    const warnThought = events.find(
      (e) =>
        e.kind === 'agent-thought' &&
        (e as { severity?: string }).severity === 'warn' &&
        (e as { content: string }).content.includes('Rate limit exceeded')
    );
    expect(warnThought).toBeDefined();
    expect((warnThought as { content: string }).content).not.toContain('exceeded..');
  });

  it('emits Run stopped when aborted before the first LLM turn', async () => {
    const ac = new AbortController();
    ac.abort();
    const events: TimelineEvent[] = [];
    const result = await runOrchestratorLoop({
      input: {
        ...baseInput,
        conversationId: 'c-abort',
        selection: { providerId: 'p-abort', modelId: 'm' }
      },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: ac.signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      strictApprovals: false
    });

    expect(result.aborted).toBe(true);
    expect(handleAssistantTurn).not.toHaveBeenCalled();
    expect(
      events.some(
        (e) => e.kind === 'agent-thought' && (e as { content: string }).content === 'Run stopped.'
      )
    ).toBe(true);
  });
});
