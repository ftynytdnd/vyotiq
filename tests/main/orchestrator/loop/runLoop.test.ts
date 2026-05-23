/**
 * `runOrchestratorLoop` abort-branch + retry-branch tests.
 *
 * Screenshot regression (§1, §4 of screenshots): user hits Stop mid-
 * stream. `fetch` rejects with `DOMException('AbortError')`.
 * `handleAssistantTurn` catches and returns `{ error }`. Before the
 * plan §2 fix, the error branch treated that as a retriable LLM
 * failure: it incremented `consecutiveErrors`, emitted the amber
 * `agent-thought` warning "LLM call failed (attempt 1/3): This
 * operation was aborted. Retrying.", and fired a `run-status: retrying`
 * — all for a user-initiated cancel that would never actually retry.
 *
 * These tests pin the new behavior:
 *
 *   - Abort path → exactly ONE `agent-text-aborted` event (when
 *     partial text/reasoning existed); ZERO `agent-thought` warning;
 *     ZERO `run-status: retrying`; run exits.
 *
 *   - Non-abort transport error → existing retry behavior
 *     preserved: `agent-thought` with `severity: 'warn'`, `run-status:
 *     retrying` event, eventual `error` after MAX_SELF_CORRECTION_ATTEMPTS.
 *
 * We mock `handleAssistantTurn` (single source of streaming behavior
 * per the audit) and the env/harness deps so the test drives only the
 * error-branch logic. `buildOrchestratorRequest` is real — it has no
 * side effects.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';

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
      // `priorConversationsXml` is required on `ContextEnvelopes`; the
      // runLoop forwards it into `buildSystemPrompt` so a missing field
      // would TS-fail (and at runtime would land as `undefined` in the
      // prompt).
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
  return {
    ...real,
    // Skip real backoff wait so the non-abort retry test doesn't stall.
    // Still honor the signal so abort-during-backoff behavior is preserved.
    backoff: vi.fn(async (_attempt: number, opts?: { signal?: AbortSignal }) => {
      if (opts?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
    })
  };
});
// Real `buildOrchestratorRequest` would import the tool registry; stub
// it to return a minimal shape — the `req.onConnect` hook is set by the
// runLoop itself on the returned object, so the stub just needs to carry
// the signal and a `providerId`/`model`.
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
import {
  endsWithQuestionMark,
  runOrchestratorLoop
} from '@main/orchestrator/loop/runLoop';

beforeEach(() => {
  vi.mocked(handleAssistantTurn).mockReset();
});

const baseInput = {
  runId: 'run-1',
  prompt: 'hi',
  selection: { providerId: 'p', modelId: 'm' },
  permissions: { allowAuto: false }
} as const;

describe('runOrchestratorLoop — abort vs retriable error', () => {
  it('exits silently on AbortError with no retry warning', async () => {
    const ctrl = new AbortController();
    vi.mocked(handleAssistantTurn).mockImplementationOnce(async () => {
      // Simulate mid-stream abort: handleAssistantTurn observed partial
      // reasoning then caught the DOMException('AbortError') from the
      // SSE reader. Return the same shape `handleAssistantTurn` does
      // on its catch path.
      ctrl.abort();
      const err = new DOMException('Aborted', 'AbortError');
      return {
        assistantMsgId: 'msg-1',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [],
        hadText: false,
        hadReasoning: true,
        reasoningEndEmitted: false,
        error: err
      };
    });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-1' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: ctrl.signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      permissions: baseInput.permissions,
      strictApprovals: false
    });

    // Must emit the aborted marker (partial reasoning existed).
    const aborted = events.filter((e) => e.kind === 'agent-text-aborted');
    expect(aborted).toHaveLength(1);
    expect((aborted[0] as { id: string }).id).toBe('msg-1');

    // Must NOT emit the phantom "Retrying" warning or a retrying status.
    const warnThoughts = events.filter(
      (e) => e.kind === 'agent-thought' && (e as { severity?: string }).severity === 'warn'
    );
    expect(warnThoughts).toHaveLength(0);
    const retryStatuses = events.filter(
      (e) => e.kind === 'run-status' && (e as { phase: string }).phase === 'retrying'
    );
    expect(retryStatuses).toHaveLength(0);

    // Exactly one assistant turn was attempted; no retry spin-up.
    expect(handleAssistantTurn).toHaveBeenCalledTimes(1);
  });

  it('preserves retry behavior on a real transport error', async () => {
    // No abort — feed three consecutive real errors so the loop
    // exhausts MAX_SELF_CORRECTION_ATTEMPTS and emits the final
    // `error` event.
    const err = new Error('HTTP 500 — upstream bad gateway');
    vi.mocked(handleAssistantTurn).mockResolvedValue({
      assistantMsgId: 'msg-err',
      assistantText: '',
      reasoningText: '',
      partialToolCalls: [],
      hadText: false,
      hadReasoning: false,
      reasoningEndEmitted: false,
      error: err
    });

    const ctrl = new AbortController();
    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-1' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: ctrl.signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      permissions: baseInput.permissions,
      strictApprovals: false
    });

    // Existing retry signaling must still work: amber warn thoughts
    // fire for each failed attempt (MAX_SELF_CORRECTION_ATTEMPTS-1 = 2
    // retries before the final `error` event).
    const warnThoughts = events.filter(
      (e) => e.kind === 'agent-thought' && (e as { severity?: string }).severity === 'warn'
    );
    expect(warnThoughts.length).toBeGreaterThanOrEqual(1);
    // A `retrying` run-status fires alongside the warn.
    const retryStatuses = events.filter(
      (e) => e.kind === 'run-status' && (e as { phase: string }).phase === 'retrying'
    );
    expect(retryStatuses.length).toBeGreaterThanOrEqual(1);
    // Final verdict is an `error` event — the three-strike escalation.
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toContain('Provider failed');
  });

  it('does not emit an aborted marker when no partial content existed', async () => {
    // Edge case: abort fires before the stream emitted any text or
    // reasoning. The cleanup emission is gated on `hadText ||
    // hadReasoning`, so nothing should be produced.
    const ctrl = new AbortController();
    vi.mocked(handleAssistantTurn).mockImplementationOnce(async () => {
      ctrl.abort();
      return {
        assistantMsgId: 'msg-2',
        assistantText: '',
        reasoningText: '',
        partialToolCalls: [],
        hadText: false,
        hadReasoning: false,
        reasoningEndEmitted: false,
        error: new DOMException('Aborted', 'AbortError')
      };
    });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-1' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      signal: ctrl.signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      permissions: baseInput.permissions,
      strictApprovals: false
    });

    expect(events.filter((e) => e.kind === 'agent-text-aborted')).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'agent-thought')).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
  });

  /**
   * Audit follow-up: the run loop owns the iteration-0 `connecting`
   * emit. `AgentV.startRun` previously also emitted a `connecting`
   * status before entering the loop, producing two consecutive
   * `connecting` rows on cold-start. The pre-loop emit was removed;
   * this test pins the invariant that exactly ONE `connecting`
   * event is produced on iter 0 (subsequent iterations naturally
   * emit their own `connecting` as they cycle).
   *
   * We drive the loop with a single clean answer so it terminates
   * after iter 0; any iter-N>0 connecting emits would inflate the
   * count and fail the assertion.
   */
  it('emits exactly one `connecting` run-status on iteration 0', async () => {
    vi.mocked(handleAssistantTurn).mockResolvedValueOnce({
      assistantMsgId: 'msg-iter0',
      assistantText: 'Final answer.',
      reasoningText: '',
      partialToolCalls: [],
      hadText: true,
      hadReasoning: false,
      reasoningEndEmitted: false,
      finishReason: 'stop'
    });

    const events: TimelineEvent[] = [];
    await runOrchestratorLoop({
      input: { ...baseInput, conversationId: 'c-1' },
      workspacePath: '/tmp/ws',
      workspaceId: 'ws-test',
      strictApprovals: false,
      signal: new AbortController().signal,
      emit: (e) => events.push(e),
      initialMessages: [{ role: 'system', content: '' }, { role: 'user', content: 'hi' }],
      initialQuery: 'hi',
      permissions: baseInput.permissions
    });

    const connecting = events.filter(
      (e) => e.kind === 'run-status' && (e as { phase: string }).phase === 'connecting'
    );
    expect(connecting).toHaveLength(1);
  });
});

/**
 * Direct unit tests for the clarify-vs-answer probe used by the
 * terminus branch to label `runStateAcc.lastAction`. The previous
 * implementation only inspected the trailing code point, which
 * mis-classified clarifying questions ending in a quotation,
 * parenthesis, or bracket as `'answer'`. The probe now walks back
 * through trailing whitespace + closing punctuation (capped at 8
 * code units) before reading the meaningful terminator.
 */
describe('endsWithQuestionMark', () => {
  it('returns true for plain `?`', () => {
    expect(endsWithQuestionMark('Want me to continue?')).toBe(true);
  });

  it('returns true for fullwidth `？`', () => {
    expect(endsWithQuestionMark('続行しますか？')).toBe(true);
  });

  it('returns true through trailing whitespace', () => {
    expect(endsWithQuestionMark('Should I continue?   \n')).toBe(true);
  });

  it('returns true through `?)` parenthetical wrap', () => {
    expect(endsWithQuestionMark('Should I (or skip)?)')).toBe(true);
  });

  it('returns true through `?"` quotation wrap', () => {
    expect(endsWithQuestionMark('"Should I continue?"')).toBe(true);
  });

  it('returns true through `？)` fullwidth + paren wrap', () => {
    expect(endsWithQuestionMark('続行しますか？)')).toBe(true);
  });

  it('returns false for a substantive answer ending with period', () => {
    expect(endsWithQuestionMark('Done. Confirmed and saved.')).toBe(false);
  });

  it('returns false for trailing exclamation', () => {
    expect(endsWithQuestionMark('Awesome!')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(endsWithQuestionMark('')).toBe(false);
  });

  it('caps the probe so a long trailing run of closers still terminates', () => {
    // 50 closing parens after a `.` — the probe walks at most 8 steps
    // and gives up on `.` (or whatever it encounters), never on `?`.
    const s = 'Done.' + ')'.repeat(50);
    expect(endsWithQuestionMark(s)).toBe(false);
  });
});
