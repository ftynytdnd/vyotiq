/**
 * Pins the post-audit sub-agent contract:
 *
 *   - Iteration cap is a flat 14 (the previous 16+1 wrap-up surface
 *     was removed; the harness now tells the worker its last action
 *     MUST be a `<result>` envelope).
 *   - When the cap is reached, `runSubAgent` returns `status:'failed'`
 *     with an error message that names the cap.
 *   - A normally-terminating worker that emits `<result>...</result>`
 *     returns the inferred status without any wrap-up nudge in the
 *     transcript.
 *
 * The provider stream is mocked so the test stays deterministic and
 * never makes a real fetch call.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatStreamDelta } from '@main/providers/chatClient';

// Deps mocked BEFORE the unit-under-test is imported.
vi.mock('@main/providers/chatClient', () => ({
  streamChat: vi.fn()
}));
vi.mock('@main/harness/harnessLoader', () => ({
  buildSubagentSystemPrompt: () => '<system_instructions>stub</system_instructions>'
}));
vi.mock('@main/orchestrator/contextManager', () => ({
  inlineFiles: vi.fn(async () => '')
}));
vi.mock('@main/orchestrator/retry', () => ({
  // Skip real backoff so an error path in a future test wouldn't stall.
  backoff: vi.fn(async () => undefined)
}));
vi.mock('@main/orchestrator/loop/handleToolCalls', () => ({
  handleToolCalls: vi.fn(async () => ({ attempted: 0, failed: 0 }))
}));

import { streamChat } from '@main/providers/chatClient';
import { runSubAgent } from '@main/orchestrator/SubAgent';

async function* streamOf(deltas: ChatStreamDelta[]): AsyncGenerator<ChatStreamDelta> {
  for (const d of deltas) yield d;
}

const baseSpec = {
  id: 'A1',
  task: 'Summarize the README.',
  files: [],
  tools: ['read', 'ls']
};

const baseDeps = {
  selection: { providerId: 'p', modelId: 'm' },
  workspacePath: 'C:/tmp/ws',
  // Audit fields added after this fixture was first written. Filled
  // with safe defaults so the structural compatibility check matches
  // the production `SubAgentDeps` shape; runtime behavior is
  // identical to the pre-audit fixture.
  workspaceId: 'ws-test',
  runId: 'run-test',
  conversationId: 'conv-test',
  strictApprovals: false,
  permissions: { allowAuto: false },
  signal: new AbortController().signal
};

beforeEach(() => {
  vi.mocked(streamChat).mockReset();
});

describe('runSubAgent — post-audit', () => {
  it('returns the inferred status from a clean <result> envelope', async () => {
    vi.mocked(streamChat).mockImplementationOnce(() =>
      streamOf([
        {
          contentDelta:
            '<result>\n<status>success</status>\n<summary>Did the thing.</summary>\n</result>'
        },
        { finishReason: 'stop' }
      ])
    );

    const run = await runSubAgent(baseSpec, baseDeps);
    expect(run.status).toBe('success');
    expect(run.output).toContain('<result>');
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  it('reports `failed` with the new cap when every iteration loops on tool calls without ever emitting <result>', async () => {
    // Drive every iteration to the "tool calls present → continue"
    // branch by streaming a `toolCallDelta` with a name. The mocked
    // `handleToolCalls` resolves trivially so the loop spins to the
    // hard cap. After the cap, the loop exits with the
    // "iteration cap reached" failure shape — NO wrap-up nudge.
    vi.mocked(streamChat).mockImplementation(() =>
      streamOf([
        {
          toolCallDelta: { index: 0, id: 'call-x', name: 'read', argumentsDelta: '{}' }
        },
        { finishReason: 'tool_calls' }
      ])
    );

    const run = await runSubAgent(baseSpec, baseDeps);
    expect(run.status).toBe('failed');
    // Cap was 14 in the new contract — both the call count and the
    // error message should reflect that.
    expect(streamChat).toHaveBeenCalledTimes(14);
    expect(run.error).toContain('14');
    // The old implementation phrased this as "iteration cap reached
    // (17 turns including wrap-up)" — assert that legacy phrasing is
    // GONE so the new flat cap is unambiguously the contract.
    expect(run.error).not.toContain('wrap-up');
  });

  it('persists thoughtSignature on assistant tool_calls for Gemini round-trip', async () => {
    let call = 0;
    vi.mocked(streamChat).mockImplementation((req) => {
      call += 1;
      if (call === 1) {
        return streamOf([
          {
            toolCallDelta: {
              index: 0,
              id: 'call-gem',
              name: 'read',
              argumentsDelta: '{}',
              thoughtSignature: 'OPAQUE_SIG_SUB'
            }
          },
          { finishReason: 'tool_calls' }
        ]);
      }
      const assistant = req.messages.find(
        (m) => m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0
      );
      expect(assistant?.tool_calls?.[0]).toMatchObject({
        thoughtSignature: 'OPAQUE_SIG_SUB'
      });
      return streamOf([
        { contentDelta: '<result><status>success</status></result>' },
        { finishReason: 'stop' }
      ]);
    });

    const run = await runSubAgent(baseSpec, baseDeps);
    expect(run.status).toBe('success');
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it('returns aborted status when the signal is already aborted at entry', async () => {
    // Top-of-loop abort check: an already-aborted signal must short-
    // circuit the very first iteration, returning `aborted` with no
    // call to `streamChat` at all.
    const ctrl = new AbortController();
    ctrl.abort();
    const run = await runSubAgent(baseSpec, { ...baseDeps, signal: ctrl.signal });
    expect(run.status).toBe('aborted');
    expect(streamChat).not.toHaveBeenCalled();
  });

  /**
   * Audit Phase 3: on the penultimate iteration (`SUBAGENT_WRAPUP_ITER`,
   * 0-indexed = 13) the host flips `tool_choice` from `'auto'` to
   * `'none'` so the provider is physically forced to emit prose. This
   * elevates the soft harness rule ("your last action MUST be a
   * `<result>`") to a wire-level guarantee.
   */
  it('flips toolChoice to "none" on the wrap-up iteration', async () => {
    // Drive every iteration through the tool-call branch so we actually
    // reach iteration 13.
    vi.mocked(streamChat).mockImplementation(() =>
      streamOf([
        {
          toolCallDelta: { index: 0, id: 'call-x', name: 'read', argumentsDelta: '{}' }
        },
        { finishReason: 'tool_calls' }
      ])
    );
    await runSubAgent(baseSpec, baseDeps);
    const calls = vi.mocked(streamChat).mock.calls;
    // 14 total iterations (0..13). Iterations 0..12 ask for 'auto';
    // iteration 13 flips to 'none'.
    expect(calls.length).toBe(14);
    for (let i = 0; i < 13; i++) {
      expect(calls[i]?.[0].toolChoice).toBe('auto');
    }
    expect(calls[13]?.[0].toolChoice).toBe('none');
  });

  /**
   * Regression — Cluster 1 audit. A mid-stream provider error that
   * lands AFTER `reasoning_content` has started streaming but BEFORE
   * any text/tool_calls transition must still emit `onTextAborted`
   * so the renderer reducer drops the orphan reasoning accumulator.
   * The gate at `SubAgent.ts:412-429` used to be `if (textOpened)`,
   * which let the reasoning slot dangle when only reasoning had
   * opened — each retry mints a fresh `assistantMsgId`, so the
   * previous iteration's reasoning could never be re-closed by a
   * later boundary. The renderer's `agent-text-aborted` reducer
   * branch clears BOTH text and reasoning accumulators for the id,
   * so one emit is sufficient.
   *
   * The retry path also calls `backoff()` (mocked above as a no-op)
   * which then `continue`s the loop and stops. We don't need to
   * exercise the full retry chain — only assert that the very first
   * error emits `onTextAborted` with the iteration's assistantMsgId.
   */
  it('emits onTextAborted on reasoning-only mid-stream error so renderer drops the orphan reasoning slot', async () => {
    // Iteration 0: stream reasoning, then throw mid-stream.
    // Iteration 1+: terminate cleanly so the test doesn't loop the cap.
    let firstCall = true;
    vi.mocked(streamChat).mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return (async function* () {
          // Reasoning lands first. NO subsequent text/tool_calls
          // means `onReasoningEnd` is NOT fired mid-stream (it only
          // fires on the reasoning → content/tool_calls transition).
          yield { reasoningDelta: 'thinking…' } as ChatStreamDelta;
          throw new Error('boom — provider closed the stream mid-reasoning');
        })();
      }
      return streamOf([
        { contentDelta: '<result><status>success</status></result>' },
        { finishReason: 'stop' }
      ]);
    });

    const aborts: Array<{ assistantMsgId: string; subagentId: string }> = [];
    const onTextAborted = (assistantMsgId: string, subagentId: string) => {
      aborts.push({ assistantMsgId, subagentId });
    };
    // Spy reasoning delta hook so we can confirm reasoning opened on
    // the iteration that errored.
    const reasoningDeltas: Array<{ delta: string; assistantMsgId: string; subagentId: string }> = [];
    const onReasoningDelta = (delta: string, assistantMsgId: string, subagentId: string) => {
      reasoningDeltas.push({ delta, assistantMsgId, subagentId });
    };

    const run = await runSubAgent(baseSpec, {
      ...baseDeps,
      onTextAborted,
      onReasoningDelta
    });
    expect(run.status).toBe('success');
    // The errored iteration's reasoning was opened.
    expect(reasoningDeltas.length).toBeGreaterThan(0);
    expect(reasoningDeltas[0]?.subagentId).toBe('A1');
    // The errored iteration emitted onTextAborted exactly once with
    // the matching assistantMsgId, even though text never opened.
    expect(aborts.length).toBe(1);
    expect(aborts[0]?.subagentId).toBe('A1');
    expect(aborts[0]?.assistantMsgId).toBe(reasoningDeltas[0]?.assistantMsgId);
  });

  /**
   * Audit Phase 6: per-sub-agent `run-status` events must be emitted
   * with `detail.subagentId` populated so the renderer can route them
   * into the matching sub-agent trace card.
   */
  it('emits run-status events tagged with the sub-agent id', async () => {
    vi.mocked(streamChat).mockImplementationOnce(() =>
      streamOf([
        { contentDelta: '<result><status>success</status></result>' },
        { finishReason: 'stop' }
      ])
    );
    const events: Array<{ phase: string; subagentId?: string }> = [];
    const onRunStatus = vi.fn((event, subagentId: string) => {
      if (event.kind === 'run-status') {
        events.push({ phase: event.phase, subagentId: event.detail?.subagentId });
      }
      // Second-arg attribution — callers rely on this for strict routing.
      expect(subagentId).toBe('A1');
    });
    await runSubAgent(baseSpec, { ...baseDeps, onRunStatus });
    // At minimum we expect a `connecting` event; providers that stream
    // before calling `onConnect` may also produce `awaiting-response`.
    expect(events.some((e) => e.phase === 'connecting')).toBe(true);
    // Every emitted event must carry the worker's id in `detail.subagentId`.
    expect(events.every((e) => e.subagentId === 'A1')).toBe(true);
  });
});

/**
 * Missing-envelope recovery (production failure shape: conversation
 * `35caa9dc-…jsonl` sub-agent D2). The worker emitted a final
 * narration in plain prose AFTER successfully running an `edit`
 * tool, but skipped the `<result>…</result>` wrap. Pre-fix the host
 * reported the round as `'malformed'` (rendered as red `failed` in
 * the timeline) even though the underlying edit had landed.
 *
 * Post-fix: the loop offers ONE recovery turn. If the model takes
 * it and emits a clean `<result>` on the retry, the worker is
 * reported as the inferred status. If the second turn ALSO lacks
 * the envelope, the worker is reported as `'malformed'` exactly
 * as before — the recovery is one-shot, not an open loop.
 */
describe('runSubAgent — missing-envelope recovery (one-shot)', () => {
  it('grants ONE recovery turn when the worker emits text without <result>', async () => {
    let call = 0;
    vi.mocked(streamChat).mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // First turn: substantive prose, NO `<result>` wrap.
        return streamOf([
          {
            contentDelta:
              'I have updated `ResponseCard.tsx` to detect and render structured file lists. Detection logic added; styling uses var(--mono).'
          },
          { finishReason: 'stop' }
        ]);
      }
      // Recovery turn: clean envelope.
      return streamOf([
        {
          contentDelta:
            '<result>\n<status>success</status>\n<summary>Updated ResponseCard.tsx.</summary>\n</result>'
        },
        { finishReason: 'stop' }
      ]);
    });

    const run = await runSubAgent(baseSpec, baseDeps);
    expect(run.status).toBe('success');
    expect(run.output).toContain('<result>');
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it('still returns malformed when the worker ignores the recovery prompt', async () => {
    // The recovery is one-shot. A worker that emits text-only on
    // BOTH turns lands as malformed and exits without ping-ponging
    // through the rest of the iteration cap.
    vi.mocked(streamChat).mockImplementation(() =>
      streamOf([
        { contentDelta: 'Just plain prose, no envelope here either.' },
        { finishReason: 'stop' }
      ])
    );

    const run = await runSubAgent(baseSpec, baseDeps);
    expect(run.status).toBe('malformed');
    // Two provider calls: original + one recovery attempt. NOT 14
    // (no spin against the cap).
    expect(streamChat).toHaveBeenCalledTimes(2);
  });

  it('does NOT trigger the recovery when the first turn already has a <result> envelope', async () => {
    // Sanity check: the recovery branch must only fire when the
    // status is 'malformed'. A clean envelope on the first turn
    // exits in one provider call — not two.
    vi.mocked(streamChat).mockImplementationOnce(() =>
      streamOf([
        { contentDelta: '<result><status>partial</status><summary>Partial.</summary></result>' },
        { finishReason: 'stop' }
      ])
    );

    const run = await runSubAgent(baseSpec, baseDeps);
    expect(run.status).toBe('partial');
    expect(streamChat).toHaveBeenCalledTimes(1);
  });

  /**
   * T0-2 — hopeless-shot short-circuit. When the first turn produces
   * zero text AND zero tool results AND no `<result>` envelope, the
   * worker has nothing to wrap. The recovery prompt would just burn
   * one more iteration on empty input. Skip the recovery, return
   * `failed` with an explicit reason, and exit in ONE provider call.
   */
  it('skips the recovery prompt when there is nothing to wrap (T0-2)', async () => {
    // Empty content + finish reason. No tool calls, no text — the
    // hopeless shape.
    vi.mocked(streamChat).mockImplementation(() =>
      streamOf([{ finishReason: 'stop' }])
    );

    const run = await runSubAgent(baseSpec, baseDeps);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('no text');
    expect(run.error).toContain('no tool calls');
    // Critically: only ONE provider call. The recovery would have
    // produced two; the short-circuit stops at one.
    expect(streamChat).toHaveBeenCalledTimes(1);
  });
});
