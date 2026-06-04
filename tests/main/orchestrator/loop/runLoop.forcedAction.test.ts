/**
 * Forced-action loop dispatch + degradation + synthesis coverage.
 *
 * The closed loop dispatches purely on the turn's tool calls:
 *   - `finish`   → emit `summary` as the final answer, return cleanly.
 *   - `ask_user` → emit the question, pause cleanly (no error).
 *   - `delegate` → spawn the sub-agent pool via `handleDelegates`.
 *   - ls/memory/recall → run via `handleToolCalls`, then continue.
 *
 * Degradation (no actionable tool call):
 *   - substantive prose → implicit finish (any dialect).
 *   - short/empty prose → one retry, then a visible error.
 *
 * Iteration cap → one `tool_choice:'none'` synthesis turn (wrapUp).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { MAX_TOTAL_ITERATIONS } from '@shared/constants';

vi.mock('@main/orchestrator/loop/handleAssistantTurn', () => ({
  handleAssistantTurn: vi.fn()
}));
vi.mock('@main/orchestrator/loop/handleToolCalls', () => ({
  handleToolCalls: vi.fn()
}));
vi.mock('@main/orchestrator/loop/handleDelegates', () => ({
  handleDelegates: vi.fn()
}));
vi.mock('@main/orchestrator/contextManager', async () => {
  const real = await vi.importActual<typeof import('@main/orchestrator/contextManager')>(
    '@main/orchestrator/contextManager'
  );
  return {
    ...real,
    refreshEnvelopes: vi.fn(async () => ({
      workspaceXml: '<workspace_context>stub</workspace_context>',
      sessionXml: '<session_context>stub</session_context>',
      priorConversationsXml: '<prior_conversations>stub</prior_conversations>',
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
  return { ...real, backoff: vi.fn(async () => undefined) };
});
// Recording mock so we can inspect the `wrapUp` flag on the synthesis turn.
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
// Provider-dialect control: default to "no record" (→ undefined dialect →
// NOT forced-capable). Capable-dialect tests mock `openai` explicitly.
vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => undefined)
}));

import { handleAssistantTurn } from '@main/orchestrator/loop/handleAssistantTurn';
import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';
import { handleDelegates } from '@main/orchestrator/loop/handleDelegates';
import { buildOrchestratorRequest } from '@main/orchestrator/loop/buildOrchestratorRequest';
import { getProviderWithKey } from '@main/providers/providerStore';
import { classifyProviderError } from '@main/providers/providerError';
import { runOrchestratorLoop } from '@main/orchestrator/loop/runLoop';

beforeEach(() => {
  vi.mocked(handleAssistantTurn).mockReset();
  vi.mocked(handleToolCalls).mockReset();
  vi.mocked(handleDelegates).mockReset();
  vi.mocked(buildOrchestratorRequest).mockClear();
  vi.mocked(getProviderWithKey).mockReset();
  vi.mocked(getProviderWithKey).mockResolvedValue(undefined as never);
});

function emptyTurn(over: Partial<Record<string, unknown>> = {}) {
  return {
    assistantMsgId: 'msg',
    assistantText: '',
    reasoningText: '',
    partialToolCalls: [],
    hadText: false,
    hadReasoning: false,
    reasoningEndEmitted: false,
    ...over
  };
}

function toolTurn(id: string, name: string, args: unknown) {
  return emptyTurn({
    assistantMsgId: `msg-${id}`,
    partialToolCalls: [{ id, name, argumentsBuf: JSON.stringify(args) }]
  });
}

function run(events: TimelineEvent[]) {
  return runOrchestratorLoop({
    input: {
      runId: 'run-1',
      prompt: 'go',
      conversationId: 'conv-1',
      selection: { providerId: 'p', modelId: 'm' },
      permissions: { allowAuto: false }
    },
    workspacePath: '/tmp/ws',
    workspaceId: 'ws-test',
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'go' }],
    initialQuery: 'go',
    permissions: { allowAuto: false },
    strictApprovals: false
  });
}

describe('runOrchestratorLoop — forced-action dispatch', () => {
  it('finish → delivers summary as the final answer and returns cleanly', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce(
      toolTurn('tc-finish', 'finish', { summary: 'All done via finish.' })
    );

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual({});
    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
    const deltas = events.filter((e) => e.kind === 'agent-text-delta');
    expect(deltas.some((e) => (e as { delta: string }).delta === 'All done via finish.')).toBe(true);
  });

  it('finish with streamed prose in the same turn does not duplicate the answer block', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce(
      emptyTurn({
        assistantMsgId: 'msg-streamed',
        assistantText: 'Already streamed answer.',
        hadText: true,
        partialToolCalls: [
          {
            id: 'tc-finish',
            name: 'finish',
            argumentsBuf: JSON.stringify({ summary: 'Already streamed answer.' })
          }
        ]
      })
    );

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual({});
    const deltas = events.filter((e) => e.kind === 'agent-text-delta');
    expect(deltas).toHaveLength(0);
    expect(events.some((e) => e.kind === 'agent-text-end' && e.id === 'msg-streamed')).toBe(true);
  });

  it('ask_user structured → emits ask-user-prompt without duplicate agent-text', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce(
      toolTurn('tc-ask', 'ask_user', {
        title: 'Migration',
        questions: [
          {
            id: 'drop',
            prompt: 'Drop the legacy column?',
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' }
            ]
          }
        ]
      })
    );

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual(
      expect.objectContaining({ pausedForAskUser: expect.any(Object) })
    );
    expect(events.some((e) => e.kind === 'ask-user-prompt')).toBe(true);
    expect(events.filter((e) => e.kind === 'agent-text-delta')).toHaveLength(0);
  });

  it('ask_user → emits ask-user-prompt and pauses cleanly (no error)', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce(
      toolTurn('tc-ask', 'ask_user', { question: 'Drop the legacy column?' })
    );

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual(
      expect.objectContaining({ pausedForAskUser: expect.any(Object) })
    );
    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
    expect(events.some((e) => e.kind === 'ask-user-prompt')).toBe(true);
    expect(events.filter((e) => e.kind === 'agent-text-delta')).toHaveLength(0);
  });

  it('ask_user with streamed prose does not duplicate question as agent-text', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce(
      emptyTurn({
        assistantMsgId: 'msg-streamed',
        assistantText: 'I will analyze the migration path next.',
        hadText: true,
        partialToolCalls: [
          {
            id: 'tc-ask',
            name: 'ask_user',
            argumentsBuf: JSON.stringify({ question: 'Drop the legacy column?' })
          }
        ]
      })
    );

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual(
      expect.objectContaining({ pausedForAskUser: expect.any(Object) })
    );
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'agent-text-delta')).toHaveLength(0);
    expect(events.some((e) => e.kind === 'ask-user-prompt')).toBe(true);
    expect(events.some((e) => e.kind === 'agent-text-end' && e.id === 'msg-streamed')).toBe(true);
  });

  it('delegate tool call → invokes handleDelegates with the parsed spec', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce(
        toolTurn('tc-d', 'delegate', { id: 'A1', task: 'Inspect src', files: 'src', tools: 'read' })
      )
      .mockResolvedValueOnce(toolTurn('tc-finish', 'finish', { summary: 'Done.' }));
    vi.mocked(handleDelegates).mockResolvedValueOnce('continue');

    const events: TimelineEvent[] = [];
    await run(events);

    expect(handleDelegates).toHaveBeenCalledTimes(1);
    const specs = vi.mocked(handleDelegates).mock.calls[0]![0];
    expect(specs).toHaveLength(1);
    expect(specs[0]!.id).toBe('A1');
    expect(specs[0]!.files).toEqual(['src']);
  });

  it('a single batched-array delegate call fans out to multiple specs', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce(
        toolTurn('tc-batch', 'delegate', [
          { id: 'A1', task: 'one' },
          { id: 'A2', task: 'two' }
        ])
      )
      .mockResolvedValueOnce(toolTurn('tc-finish', 'finish', { summary: 'Done.' }));
    vi.mocked(handleDelegates).mockResolvedValueOnce('continue');

    const events: TimelineEvent[] = [];
    await run(events);

    expect(handleDelegates).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleDelegates).mock.calls[0]![0].map((d) => d.id)).toEqual(['A1', 'A2']);
  });

  it('continue-tool round (ls) → runs handleToolCalls then keeps looping', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce(toolTurn('tc-ls', 'ls', { path: 'src' }))
      .mockResolvedValueOnce(toolTurn('tc-finish', 'finish', { summary: 'Done.' }));
    vi.mocked(handleToolCalls).mockResolvedValueOnce({ attempted: 1, failed: 0, childRedelegations: 0 });

    const events: TimelineEvent[] = [];
    await run(events);

    expect(handleToolCalls).toHaveBeenCalledTimes(1);
    expect(handleAssistantTurn).toHaveBeenCalledTimes(2);
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
  });

  it('ask_user + delegate in one turn pauses immediately without running delegation', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce({
      assistantMsgId: 'msg-mixed',
      assistantText: '',
      reasoningText: '',
      partialToolCalls: [
        {
          id: 'tc-d',
          name: 'delegate',
          argumentsBuf: JSON.stringify({ id: 'A1', task: 'Inspect src', tools: 'read' })
        },
        {
          id: 'tc-ask',
          name: 'ask_user',
          argumentsBuf: JSON.stringify({ question: 'Which branch?' })
        }
      ],
      hadText: false,
      hadReasoning: false,
      reasoningEndEmitted: false
    });

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual(
      expect.objectContaining({ pausedForAskUser: expect.any(Object) })
    );
    expect(handleDelegates).not.toHaveBeenCalled();
    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.kind === 'ask-user-prompt')).toBe(true);
  });

  it('finish + ask_user in one turn prefers ask_user and ignores finish', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce({
      assistantMsgId: 'msg-both',
      assistantText: '',
      reasoningText: '',
      partialToolCalls: [
        {
          id: 'tc-finish',
          name: 'finish',
          argumentsBuf: JSON.stringify({ summary: 'All done.' })
        },
        {
          id: 'tc-ask',
          name: 'ask_user',
          argumentsBuf: JSON.stringify({ question: 'Confirm before shipping?' })
        }
      ],
      hadText: false,
      hadReasoning: false,
      reasoningEndEmitted: false
    });

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual(
      expect.objectContaining({ pausedForAskUser: expect.any(Object) })
    );
    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.kind === 'ask-user-prompt')).toBe(true);
    expect(events.filter((e) => e.kind === 'agent-text-delta')).toHaveLength(0);
  });

  it('invalid delegate args emit synthetic tool error instead of intercept stub', async () => {
    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce(
        toolTurn('tc-bad', 'delegate', { task: 'missing id field' })
      )
      .mockResolvedValueOnce(toolTurn('tc-finish', 'finish', { summary: 'Done.' }));

    const events: TimelineEvent[] = [];
    await run(events);

    const results = events.filter((e) => e.kind === 'tool-result');
    expect(results).toHaveLength(1);
    const result = results[0] as { result: { ok: boolean; error?: string; output: string } };
    expect(result.result.ok).toBe(false);
    expect(result.result.error).toBe('invalid delegate arguments');
    expect(result.result.output).toMatch(/require.*id.*task/i);
    expect(handleDelegates).not.toHaveBeenCalled();
    expect(handleAssistantTurn).toHaveBeenCalledTimes(2);
  });
});

describe('runOrchestratorLoop — degradation paths', () => {
  it('empty turn with no substantive prose → one retry, then a visible error', async () => {
    vi.mocked(getProviderWithKey).mockResolvedValue({
      name: 'OpenAI',
      dialect: 'openai'
    } as never);
    vi.mocked(handleAssistantTurn).mockResolvedValue(emptyTurn());

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(handleAssistantTurn).toHaveBeenCalledTimes(2);
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toMatch(
      /no tool call and no substantive answer/i
    );
    expect(result.terminalError).toBeDefined();
  });

  it('openai + substantive prose → accepted as an implicit finish (no error)', async () => {
    vi.mocked(getProviderWithKey).mockResolvedValue({
      name: 'OpenAI',
      dialect: 'openai'
    } as never);
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce(
      emptyTurn({
        assistantText:
          'Hello! Let me know what you would like to work on in this project today.',
        hadText: true
      })
    );

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual({});
    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
  });

  it('ollama + substantive prose → accepted as an implicit finish (no error)', async () => {
    vi.mocked(getProviderWithKey).mockResolvedValue({
      name: 'Ollama',
      dialect: 'ollama-native'
    } as never);
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce(
      emptyTurn({
        assistantText:
          'I reviewed the module and it already handles the edge case correctly.',
        hadText: true
      })
    );

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual({});
    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
  });

  it('ollama + short/announce-only prose → one retry, then a visible error', async () => {
    vi.mocked(getProviderWithKey).mockResolvedValue({
      name: 'Ollama',
      dialect: 'ollama-native'
    } as never);
    vi.mocked(handleAssistantTurn).mockResolvedValue(
      emptyTurn({ assistantText: 'Okay.', hadText: true })
    );

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(handleAssistantTurn).toHaveBeenCalledTimes(2); // initial + one retry
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toMatch(
      /no tool call and no substantive answer/i
    );
    expect(result.terminalError).toBeDefined();
  });
});

describe('runOrchestratorLoop — tool_choice 400 safety net', () => {
  it('retries the same iteration with omitToolChoice instead of terminating', async () => {
    const toolChoice400 = classifyProviderError({
      url: 'https://api.deepseek.com/v1/chat/completions',
      status: 400,
      statusText: 'Bad Request',
      body: JSON.stringify({
        error: {
          message: 'Thinking mode does not support this tool_choice',
          type: 'invalid_request_error'
        }
      }),
      surface: 'chat',
      providerId: 'p',
      providerName: 'DeepSeek'
    });

    vi.mocked(handleAssistantTurn)
      .mockResolvedValueOnce(emptyTurn({ error: toolChoice400 }))
      .mockResolvedValueOnce(toolTurn('tc-finish', 'finish', { summary: 'Recovered.' }));

    const events: TimelineEvent[] = [];
    const result = await run(events);

    // No terminal error — the run recovered.
    expect(result).toEqual({});
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
    // Two assistant turns: the rejected one + the omit-retry.
    expect(handleAssistantTurn).toHaveBeenCalledTimes(2);
    // The retry built its request with the run-scoped omit flag set.
    const omitCalls = vi
      .mocked(buildOrchestratorRequest)
      .mock.calls.filter(([opts]) => (opts as { omitToolChoice?: boolean }).omitToolChoice === true);
    expect(omitCalls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('runOrchestratorLoop — iteration-cap synthesis', () => {
  it('forces a tool_choice:"none" wrap-up turn and delivers a final answer', async () => {
    // Every turn does work (ls) and never finishes, so the loop runs to
    // the iteration cap and then issues the synthesis turn.
    vi.mocked(handleAssistantTurn).mockResolvedValue(toolTurn('tc-ls', 'ls', { path: 'src' }));
    vi.mocked(handleToolCalls).mockResolvedValue({ attempted: 1, failed: 0, childRedelegations: 0 });

    const events: TimelineEvent[] = [];
    const result = await run(events);

    expect(result).toEqual({});
    // One handleAssistantTurn per iteration + one synthesis turn.
    expect(vi.mocked(handleAssistantTurn).mock.calls.length).toBe(MAX_TOTAL_ITERATIONS + 1);
    // The synthesis turn was built with wrapUp:true (→ tool_choice:'none').
    const wrapUpCalls = vi
      .mocked(buildOrchestratorRequest)
      .mock.calls.filter(([opts]) => (opts as { wrapUp?: boolean }).wrapUp === true);
    expect(wrapUpCalls).toHaveLength(1);
    // The synth turn produced no prose (ls call), so the loop delivers a
    // minimal honest notice as the final answer.
    const deltas = events.filter((e) => e.kind === 'agent-text-delta');
    expect(
      deltas.some((e) => /iteration limit/i.test((e as { delta: string }).delta))
    ).toBe(true);
  });
});
