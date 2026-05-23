/**
 * Regression tests for `handleToolCalls`'s allowlist enforcement.
 *
 * The orchestrator's tool surface is restricted by
 * `tools/policy/orchestratorTools.ts` (`ls`, `memory`, `recall`) and
 * the harness explicitly tells the model the host will reject any
 * direct call to a delegated tool. Pre-fix, `runLoop.ts` did NOT
 * pass an allowlist to `handleToolCalls`, so a misbehaving model
 * (or a provider compat layer that promotes a native non-OpenAI
 * tool-call into a `tool_calls` block regardless of schema) could
 * still smuggle an `edit` / `bash` / `delete` call through and
 * bypass the entire delegate pattern. The harness promise was a lie
 * in production code.
 *
 * Post-fix, `runLoop.ts` passes `ORCHESTRATOR_TOOLS` as the
 * allowlist and the existing refusal path now ALSO fires for the
 * orchestrator. We assert:
 *   1. A disallowed tool call NEVER reaches `runToolByName` —
 *      no `tool-call` / `tool-result` timeline events emit.
 *   2. The synthetic `role:"tool"` refusal message is appended to
 *      `messages` so the next iteration's prompt carries the
 *      refusal and the model can self-correct.
 *   3. The orchestrator-context refusal includes an actionable
 *      `<delegate>` hint so the model knows the recovery path;
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
  permissions: { allowAuto: true },
  strictApprovals: false,
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
    //    the orchestrator with an actionable `<delegate>` hint.
    expect(messages).toHaveLength(1);
    const refusal = messages[0]!;
    expect(refusal.role).toBe('tool');
    expect(refusal.content).toContain(
      'not callable from the orchestrator'
    );
    expect(refusal.content).toContain('<delegate');
    expect(refusal.content).toContain('tools="edit"');
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
    expect(messages[0]!.content).toContain('tools="bash"');
    expect(messages[1]!.content).toContain('not callable from the orchestrator');
    expect(messages[1]!.content).toContain('tools="delete"');
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
  });

  it('emits one consolidated phase row when delegate is refused in parallel', async () => {
    const messages: ChatMessage[] = [];
    const emit = vi.fn<(e: TimelineEvent) => void>();
    const calls = Array.from({ length: 8 }, (_, i) =>
      makePartialCall('delegate', JSON.stringify({ id: `A${i + 1}` }), `c${i}`)
    );
    const summary = await handleToolCalls(
      calls,
      messages,
      emit,
      { ...baseOpts, allowlist: ORCHESTRATOR_TOOLS }
    );
    expect(summary.childRedelegations).toBe(8);
    const phases = emit.mock.calls
      .map(([e]) => e)
      .filter((e) => e.kind === 'phase');
    expect(phases).toHaveLength(1);
    expect(phases[0]!.label).toContain('8 times');
    expect(phases[0]!.label).toContain('<delegate');
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
      'Tool "edit" not in allowlist for this sub-agent.'
    );
    // Crucially does NOT contain the orchestrator-only hint.
    expect(messages[0]!.content).not.toContain('not callable from the orchestrator');
    expect(messages[0]!.content).not.toContain('<delegate');
  });
});
