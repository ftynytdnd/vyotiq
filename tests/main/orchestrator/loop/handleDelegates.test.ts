/**
 * `handleDelegates` — three-strike halt fidelity test.
 *
 * The audit follow-up moved the `<subagent_results>` envelope push so
 * it lands BEFORE the halt-vs-continue decision. Earlier behavior
 * emitted the `error` event and returned `'halt'` while skipping the
 * envelope, leaving the model's reconstructed history with raw
 * spawn/status/result events but no synthesized verifier verdict for
 * the failing round. The fix is verified end-to-end here:
 *
 *   - On a third consecutive bad-round invocation, `messages` MUST
 *     gain a new `<subagent_results>` envelope BEFORE `'halt'` is
 *     returned.
 *   - The `error` event MUST still fire so the renderer can surface
 *     the escalation.
 *   - The continue path is unchanged: a clean round with at least
 *     one `ok` verdict still pushes the envelope and resets the
 *     bad-rounds counter.
 *
 * Provider/sub-agent layers are mocked so the test is deterministic
 * and never fetches.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat';
import { MAX_DELEGATION_BAD_ROUNDS } from '@shared/constants';

// `runSubAgentPool` is replaced with a deterministic stub that returns
// the verdicts we want to exercise. Sub-agent telemetry callbacks
// (`onSpawn`, `onResult`, …) are invoked so the timeline event shape
// stays realistic, but no streaming / fetch occurs.
vi.mock('@main/orchestrator/SubAgentPool', () => ({
  runSubAgentPool: vi.fn()
}));

import { runSubAgentPool } from '@main/orchestrator/SubAgentPool';
import { handleDelegates, type DelegationCounters } from '@main/orchestrator/loop/handleDelegates';

// Shared opts fixture for every handleDelegates test. The `Opts` shape
// grew over time (providerName / workspaceId / runId / conversationId /
// strictApprovals) but the fixture didn't track all the additions — the
// IDE typechecker flags this on every edit. Filling out the full
// `HandleDelegatesOpts` once here keeps each test concise without
// re-declaring the dummy values inline. Runtime behavior is unaffected
// (the mocked `runSubAgentPool` ignores all of these except `signal`).
const baseOpts = {
  selection: { providerId: 'p', modelId: 'm' },
  providerName: 'p',
  workspacePath: '/tmp/ws',
  workspaceId: 'ws-test',
  runId: 'run-test',
  conversationId: 'conv-test',
  permissions: { allowFileWrites: false, allowBash: false, allowWebSearch: false },
  strictApprovals: false,
  signal: new AbortController().signal
} as const;

beforeEach(() => {
  vi.mocked(runSubAgentPool).mockReset();
});

describe('handleDelegates — envelope-before-halt fidelity', () => {
  it('pushes <subagent_results> BEFORE the third-strike halt fires', async () => {
    // Pool returns one sub-agent verdict, all-bad. With the strike
    // counter pre-loaded to `MAX_DELEGATION_BAD_ROUNDS - 1`, this
    // round will trip the halt branch.
    vi.mocked(runSubAgentPool).mockResolvedValueOnce([
      {
        id: 'A1',
        task: 'doomed',
        output: '<result><status>failed</status><summary>n/a</summary></result>',
        toolResults: [],
        status: 'failed',
        error: 'simulated'
      }
    ]);

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: MAX_DELEGATION_BAD_ROUNDS - 1
    };

    const outcome = await handleDelegates(
      [{ id: 'A1', task: 'doomed', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    expect(outcome).toBe('halt');
    // Strike counter incremented to the threshold.
    expect(counters.consecutiveBadRounds).toBe(MAX_DELEGATION_BAD_ROUNDS);
    // The envelope MUST be in `messages` even though the round halted.
    const envelopes = messages.filter(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('<subagent_results>') &&
        m.content.includes('id="A1"')
    );
    expect(envelopes).toHaveLength(1);
    // And the renderer error event still fires for escalation.
    const errors = events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toContain('failed verification');
  });

  it('continue path still pushes the envelope and resets the counter on a clean round', async () => {
    vi.mocked(runSubAgentPool).mockResolvedValueOnce([
      {
        id: 'A1',
        task: 'good',
        output:
          '<result><status>success</status><summary>did the thing</summary></result>',
        toolResults: [],
        status: 'success'
      }
    ]);

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = { consecutiveBadRounds: 1 };

    const outcome = await handleDelegates(
      [{ id: 'A1', task: 'good', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    expect(outcome).toBe('continue');
    // A non-bad round MUST reset the strike counter.
    expect(counters.consecutiveBadRounds).toBe(0);
    // No `error` event on the happy path.
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
    // Envelope still lands in messages — the orchestrator reads
    // verified results from it on the next iteration.
    const envelopes = messages.filter(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('<subagent_results>')
    );
    expect(envelopes).toHaveLength(1);
  });

  it('strips worker output outside `<result>...</result>` before persisting `subagent-result`', async () => {
    // Audit fix §1.7: the worker often rambles before its closing
    // `<result>` envelope. The renderer must persist ONLY the
    // envelope so JSONL transcripts and replay envelopes don't
    // accumulate the chain-of-thought.
    const rambleAndResult =
      'thinking out loud about the task… maybe I should check the harness… ' +
      'ok let me proceed.\n\n' +
      '<result><status>success</status><summary>looked at the harness</summary></result>';

    vi.mocked(runSubAgentPool).mockImplementationOnce(async (_specs, deps) => {
      const run = {
        id: 'A1',
        task: 'rambling worker',
        output: rambleAndResult,
        toolResults: [],
        status: 'success' as const
      };
      // Mirror the real pool's contract — invoke `onResult` so
      // `handleDelegates`'s emit-side strip logic runs.
      deps.onResult?.(run);
      return [run];
    });

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = { consecutiveBadRounds: 0 };

    await handleDelegates(
      [{ id: 'A1', task: 'rambling worker', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    const subagentResult = events.find((e) => e.kind === 'subagent-result') as
      | Extract<TimelineEvent, { kind: 'subagent-result' }>
      | undefined;
    expect(subagentResult).toBeDefined();
    // The pre-result ramble MUST be stripped.
    expect(subagentResult!.output).not.toContain('thinking out loud');
    expect(subagentResult!.output).not.toContain('proceed.');
    // The envelope itself MUST survive verbatim.
    expect(subagentResult!.output).toContain('<status>success</status>');
    expect(subagentResult!.output).toMatch(/^<result>[\s\S]*<\/result>$/);
  });

  it('preserves the raw output when no <result> envelope exists (Audit fix §1.7 fallback)', async () => {
    // Worker died before emitting any envelope. We keep the raw
    // body so the renderer's empty-state path can surface it under
    // a "worker output (no envelope)" label, instead of dropping
    // the only signal the user has.
    const noEnvelope = 'fatal error before I could finish';
    vi.mocked(runSubAgentPool).mockImplementationOnce(async (_specs, deps) => {
      const run = {
        id: 'A1',
        task: 'crashed worker',
        output: noEnvelope,
        toolResults: [],
        status: 'failed' as const,
        error: 'crash'
      };
      deps.onResult?.(run);
      return [run];
    });

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = { consecutiveBadRounds: 0 };

    await handleDelegates(
      [{ id: 'A1', task: 'crashed worker', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    const subagentResult = events.find((e) => e.kind === 'subagent-result') as
      | Extract<TimelineEvent, { kind: 'subagent-result' }>
      | undefined;
    expect(subagentResult).toBeDefined();
    expect(subagentResult!.output).toBe(noEnvelope);
  });

  it('emits a verdict-summary phase event RIGHT BEFORE the halt error (review finding B2)', async () => {
    // Without this row, the user sees only `error: "${N} consecutive
    // sub-agent rounds failed verification — escalating to user."`
    // and has to expand every SubAgentTrace card to triage which
    // workers failed with what structural verdict. The verdict-summary
    // phase event carries the per-id structural outcome directly in
    // the timeline so the cause is visible at a glance.
    vi.mocked(runSubAgentPool).mockResolvedValueOnce([
      {
        id: 'A1',
        task: 'doomed',
        output: '<result><status>failed</status></result>',
        toolResults: [],
        status: 'failed',
        error: 'simulated'
      },
      {
        id: 'A2',
        task: 'also doomed',
        // No `<result>` envelope at all → verifier classifies as `malformed`.
        output: 'I gave up halfway through',
        toolResults: [],
        status: 'failed',
        error: 'no envelope'
      }
    ]);

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: MAX_DELEGATION_BAD_ROUNDS - 1
    };

    const outcome = await handleDelegates(
      [
        { id: 'A1', task: 'doomed', files: [], tools: [] },
        { id: 'A2', task: 'also doomed', files: [], tools: [] }
      ],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    expect(outcome).toBe('halt');
    // Two boundary signals must appear together: the verdict summary
    // (phase, narration) and the escalation (error, halt trigger).
    const phaseIdx = events.findIndex(
      (e) =>
        e.kind === 'phase' &&
        typeof (e as { label?: unknown }).label === 'string' &&
        (e as { label: string }).label.includes('Three-strike halt')
    );
    const errorIdx = events.findIndex((e) => e.kind === 'error');
    expect(phaseIdx).toBeGreaterThanOrEqual(0);
    expect(errorIdx).toBeGreaterThanOrEqual(0);
    // The phase MUST come before the error so the renderer paints
    // cause-then-effect in timeline order.
    expect(phaseIdx).toBeLessThan(errorIdx);
    // The phase label must enumerate BOTH sub-agent ids and their
    // structural verdicts so the user can match rows to outcomes.
    const phaseLabel = (events[phaseIdx] as { label: string }).label;
    expect(phaseLabel).toContain('A1=self-failed');
    expect(phaseLabel).toContain('A2=malformed');
  });

  it('does not halt below the threshold even on an all-bad round', async () => {
    vi.mocked(runSubAgentPool).mockResolvedValueOnce([
      {
        id: 'A1',
        task: 'doomed',
        output: '<result><status>failed</status></result>',
        toolResults: [],
        status: 'failed',
        error: 'simulated'
      }
    ]);

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = { consecutiveBadRounds: 0 };

    const outcome = await handleDelegates(
      [{ id: 'A1', task: 'doomed', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    expect(outcome).toBe('continue');
    expect(counters.consecutiveBadRounds).toBe(1);
    // Envelope is pushed; no escalation event.
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(0);
    expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('<subagent_results>'))).toBe(true);
  });
});
