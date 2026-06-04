/**
 * Regression tests for `handleToolCalls`'s allowlist enforcement.
 *
 * The orchestrator's tool surface is restricted by
 * `tools/policy/orchestratorTools.ts` (`ls`, `memory`, `recall`,
 * `delegate`, `finish`, `ask_user`). `runLoop.ts` passes
 * `ORCHESTRATOR_TOOLS` as the allowlist so a misbehaving model (or a
 * provider compat layer that promotes a native non-OpenAI tool-call
 * into a `tool_calls` block regardless of schema) cannot smuggle an
 * `edit` / `bash` / `delete` call through and bypass the delegate
 * pattern. We assert:
 *   1. A disallowed tool call NEVER reaches `runToolByName` —
 *      no `tool-call` / `tool-result` timeline events emit.
 *   2. The synthetic `role:"tool"` refusal message is appended to
 *      `messages` so the next iteration's prompt carries the
 *      refusal and the model can self-correct.
 *   3. The orchestrator-context refusal includes an actionable
 *      `delegate`-tool hint so the model knows the recovery path;
 *      sub-agent-context refusal keeps the concise legacy text.
 *   4. Allowed tools (`ls`) still flow through normally.
 *   5. The return summary (`attempted` / `failed`) treats a refusal
 *      as `attempted: 0` so the three-strike counter is not burnt
 *      on an allowlist refusal (matches the audit §6.5 contract).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat';
import type { PartialToolCall } from '@main/orchestrator/loop/handleAssistantTurn';
import type { ToolResult } from '@shared/types/tool';

const runToolByName = vi.fn(
  async (
    name: string,
    _args: Record<string, unknown>,
    _ctx: unknown
  ): Promise<ToolResult> => ({
    id: `result-for-${name}`,
    name: name as ToolResult['name'],
    ok: true,
    output: `ran ${name}`,
    durationMs: 1
  })
);

vi.mock('@main/orchestrator/toolRunner', () => ({
  runToolByName: (name: string, args: Record<string, unknown>, ctx: unknown) =>
    runToolByName(name, args, ctx)
}));

import { handleToolCalls } from '@main/orchestrator/loop/handleToolCalls';
import { ORCHESTRATOR_TOOLS } from '@main/tools/policy/index';

const baseOpts = {
  workspacePath: '/tmp/workspace',
  workspaceId: 'ws-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  permissions: {},
  signal: new AbortController().signal
};

function makePartialCall(
  name: string,
  argsJson: string = '{}',
  id: string = `call-${name}`
): PartialToolCall {
  return {
    id,
    name,
    argumentsBuf: argsJson
  };
}

beforeEach(() => {
  runToolByName.mockClear();
});

describe('handleToolCalls — orchestrator allowlist enforcement', () => {
  it('refuses an `edit` tool call when ORCHESTRATOR_TOOLS is the allowlist', async () => {
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    const summary = await handleToolCalls(
      [
        makePartialCall(
          'edit',
          JSON.stringify({ path: 'test_note.txt', create: true, content: 'hi' })
        )
      ],
      messages,
      emit,
      { ...baseOpts, allowlist: ORCHESTRATOR_TOOLS }
    );

    // 1. No tool actually ran — `runToolByName` was never invoked.
    expect(runToolByName).not.toHaveBeenCalled();
    // 2. No timeline events emitted (refusal is silent at the UI level —
    //    the next iteration carries the failure forward via the
    //    synthetic tool message).
    expect(emit).not.toHaveBeenCalled();
    // 3. Synthetic refusal message landed on `messages`, addressed to
    //    the orchestrator with an actionable `delegate`-tool hint.
    expect(messages).toHaveLength(1);
    const refusal = messages[0]!;
    expect(refusal.role).toBe('tool');
    expect(refusal.content).toContain(
      'not callable from the orchestrator'
    );
    expect(refusal.content).toContain('`delegate` tool');
    expect(refusal.content).toContain('"tools":["edit"]');
    // 4. Refusal counts as 0 attempted, 0 failed — does not burn the
    //    three-strike consecutive-failed-tool-round budget.
    expect(summary).toEqual({ attempted: 0, failed: 0, childRedelegations: 0 });
  });

  it('refuses `bash` and `delete` with the same orchestrator hint copy', async () => {
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    await handleToolCalls(
      [
        makePartialCall('bash', JSON.stringify({ command: 'echo hi > x' }), 'c1'),
        makePartialCall('delete', JSON.stringify({ path: 'x' }), 'c2')
      ],
      messages,
      emit,
      { ...baseOpts, allowlist: ORCHESTRATOR_TOOLS }
    );
    expect(runToolByName).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toContain('not callable from the orchestrator');
    expect(messages[0]!.content).toContain('"tools":["bash"]');
    expect(messages[1]!.content).toContain('not callable from the orchestrator');
    expect(messages[1]!.content).toContain('"tools":["delete"]');
  });

  it('allows `ls`, `memory`, `recall` — every orchestrator-policy tool flows through', async () => {
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    const calls = [
      makePartialCall('ls', JSON.stringify({ path: '.' }), 'c1'),
      makePartialCall('memory', JSON.stringify({ action: 'list' }), 'c2'),
      makePartialCall('recall', JSON.stringify({ action: 'list' }), 'c3')
    ];
    const summary = await handleToolCalls(
      calls,
      messages,
      emit,
      { ...baseOpts, allowlist: ORCHESTRATOR_TOOLS }
    );
    expect(runToolByName).toHaveBeenCalledTimes(3);
    // Three tool-call + three tool-result + per-call run-status events.
    const toolCallEmits = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'tool-call');
    expect(toolCallEmits).toHaveLength(3);
    const toolResultEmits = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'tool-result');
    expect(toolResultEmits).toHaveLength(3);
    expect(summary).toEqual({ attempted: 3, failed: 0, childRedelegations: 0 });
    expect(messages).toHaveLength(3);
    // None of the responses use the refusal phrase.
    for (const m of messages) {
      expect(m.content).not.toContain('not callable from the orchestrator');
    }
    const phases = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'phase' && e.label === 'Exploring');
    expect(phases).toHaveLength(0);
    const statuses = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'run-status');
    expect(statuses.length).toBeGreaterThanOrEqual(3);
    for (const status of statuses) {
      expect(status.label).toBe('Exploring');
    }
  });

  it('emits Exploring run-status for sub-agent tool rounds', async () => {
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    await handleToolCalls(
      [makePartialCall('read', JSON.stringify({ path: 'foo.ts' }), 'c1')],
      messages,
      emit,
      { ...baseOpts, subagentId: 'A1', allowlist: ['read'] }
    );
    expect(runToolByName).toHaveBeenCalledTimes(1);
    const statuses = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'run-status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      kind: 'run-status',
      phase: 'running-tool',
      label: 'Exploring',
      detail: { toolName: 'read', subagentId: 'A1' }
    });
    const phases = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'phase');
    expect(phases).toHaveLength(0);
  });

  it('does NOT refuse `delegate` at the orchestrator — it is a first-class tool now', () => {
    // The forced-action loop promoted `delegate` into ORCHESTRATOR_TOOLS,
    // so the orchestrator's allowlist contains it. (In production the run
    // loop also intercepts delegate by name BEFORE handleToolCalls — see
    // `extractDelegateToolCalls` — so it never reaches here at all.)
    expect(ORCHESTRATOR_TOOLS).toContain('delegate');
  });

  it('counts a SUB-AGENT delegate attempt as a re-delegation and refuses it per call', async () => {
    // A sub-agent's allowlist never includes `delegate` (it cannot nest).
    // Each refused delegate increments `childRedelegations`. Phase-row
    // declutter (phase_spam: remove): the "cannot nest further" `phase`
    // row was dropped — the refusal is fed back to the model through the
    // refused tool result itself, so the row was redundant clutter.
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    const nestedDelegatePhaseEmitted = new Set<string>();
    const calls = [
      makePartialCall('delegate', JSON.stringify({ id: 'A1', task: 't1' }), 'c1'),
      makePartialCall('delegate', JSON.stringify({ id: 'A2', task: 't2' }), 'c2')
    ];
    const summary = await handleToolCalls(
      calls,
      messages,
      emit,
      { ...baseOpts, subagentId: 'W1', allowlist: ['read'], nestedDelegatePhaseEmitted }
    );
    // Behavioral contract intact: both nested delegates refused, counted,
    // and never executed.
    expect(runToolByName).not.toHaveBeenCalled();
    expect(summary).toEqual({ attempted: 0, failed: 0, childRedelegations: 2 });
    // No "cannot nest further" phase row is emitted any longer.
    const phases = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'phase');
    expect(phases).toHaveLength(0);
    // The refusal message uses the concise sub-agent copy — no
    // orchestrator-only delegate-tool hint — and reaches the model.
    expect(messages).toHaveLength(2);
    for (const m of messages) {
      expect(m.content).toContain('not available for this sub-agent');
    }
  });

  it('keeps the concise sub-agent refusal copy when subagentId is set', async () => {
    // Sub-agent context: `subagentId` is defined; refusal text should
    // be the original concise one without the orchestrator-specific
    // delegate hint (sub-agents cannot re-delegate).
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    await handleToolCalls(
      [makePartialCall('edit')],
      messages,
      emit,
      { ...baseOpts, subagentId: 'A1', allowlist: ['read'] }
    );
    expect(runToolByName).not.toHaveBeenCalled();
    expect(messages).toHaveLength(1);
    expect(messages[0]!.content).toBe(
      'Tool "edit" is not available for this sub-agent — use the granted toolset.'
    );
    // Crucially does NOT contain the orchestrator-only hint.
    expect(messages[0]!.content).not.toContain('not callable from the orchestrator');
    expect(messages[0]!.content).not.toContain('<delegate');
  });

  it('calls onToolCallSettled on allowlist refusal without emitting tool-call', async () => {
    const onToolCallSettled = vi.fn();
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    await handleToolCalls(
      [makePartialCall('edit', '{}', 'call-edit')],
      messages,
      emit,
      { ...baseOpts, allowlist: ORCHESTRATOR_TOOLS, onToolCallSettled }
    );
    expect(runToolByName).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(onToolCallSettled).toHaveBeenCalledTimes(1);
    expect(onToolCallSettled).toHaveBeenCalledWith('call-edit', 'orc', 0);
  });

  it('calls onToolCallSettled for synthetic failures on abort mid-batch', async () => {
    const onToolCallSettled = vi.fn();
    const ac = new AbortController();
    ac.abort();
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    await handleToolCalls(
      [
        makePartialCall('read', '{}', 'c1'),
        makePartialCall('read', '{}', 'c2')
      ],
      messages,
      emit,
      { ...baseOpts, allowlist: ['read'], signal: ac.signal, onToolCallSettled }
    );
    expect(onToolCallSettled).toHaveBeenCalledTimes(2);
    expect(onToolCallSettled).toHaveBeenNthCalledWith(1, 'c1', 'orc', 0);
    expect(onToolCallSettled).toHaveBeenNthCalledWith(2, 'c2', 'orc', 1);
    const results = emit.mock.calls.map(([e]) => e).filter((e) => e.kind === 'tool-result');
    expect(results).toHaveLength(2);
  });

  it('does not emit Exploring run-status when tool args fail to parse', async () => {
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    await handleToolCalls(
      [makePartialCall('read', 'not-json', 'bad-args')],
      messages,
      emit,
      { ...baseOpts, allowlist: ORCHESTRATOR_TOOLS }
    );
    expect(runToolByName).not.toHaveBeenCalled();
    const statuses = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'run-status');
    expect(statuses).toHaveLength(0);
    const phases = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'phase');
    expect(phases).toHaveLength(0);
  });
});
