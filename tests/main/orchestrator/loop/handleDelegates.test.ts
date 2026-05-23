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

vi.mock('@main/orchestrator/verifyDelegateArtifacts.js', () => ({
  verifyDelegateArtifacts: vi.fn(async () => []),
  formatHostVerificationXml: vi.fn(() => '')
}));

import { runSubAgentPool } from '@main/orchestrator/SubAgentPool';
import {
  verifyDelegateArtifacts,
  formatHostVerificationXml
} from '@main/orchestrator/verifyDelegateArtifacts.js';
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
  permissions: { allowAuto: false },
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
      consecutiveBadRounds: MAX_DELEGATION_BAD_ROUNDS - 1,
      perTaskBadStreak: new Map()
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
    const counters: DelegationCounters = {
      consecutiveBadRounds: 1,
      perTaskBadStreak: new Map()
    };

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
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

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
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

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
      consecutiveBadRounds: MAX_DELEGATION_BAD_ROUNDS - 1,
      perTaskBadStreak: new Map()
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
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

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

describe('handleDelegates — per-task strike map', () => {
  it('tracks consecutive bad verdicts per task signature across mixed rounds', async () => {
    // Mixed round: one bad verdict + one good verdict. `consecutiveBadRounds`
    // resets to 0 (because not allBad) but the BAD task's per-task
    // streak should be 1, while the GOOD task is absent from the map.
    vi.mocked(runSubAgentPool).mockResolvedValueOnce([
      {
        id: 'A1',
        task: 'edit frontend/src/App.tsx',
        output: '<result><status>failed</status></result>',
        toolResults: [],
        status: 'failed',
        error: 'malformed'
      },
      {
        id: 'A2',
        task: 'edit frontend/src/Header.tsx',
        output: '<result><status>success</status><summary>ok</summary></result>',
        toolResults: [],
        status: 'success'
      }
    ]);

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

    await handleDelegates(
      [
        { id: 'A1', task: 'edit frontend/src/App.tsx', files: [], tools: [] },
        { id: 'A2', task: 'edit frontend/src/Header.tsx', files: [], tools: [] }
      ],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    expect(counters.consecutiveBadRounds).toBe(0); // mixed → reset
    // The failing task gained one streak; the successful one is not tracked.
    const streaks = Array.from(counters.perTaskBadStreak.values());
    expect(streaks).toEqual([1]);
  });

  it('emits a pivot phase divider when a task crosses MAX_PER_TASK_BAD_STREAK', async () => {
    // Three consecutive bad rounds for the SAME task signature, each
    // paired with a successful sibling so `consecutiveBadRounds` stays
    // 0 throughout. The per-task counter should escalate on the third
    // round and emit a phase divider.
    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

    for (let round = 0; round < 3; round++) {
      vi.mocked(runSubAgentPool).mockResolvedValueOnce([
        {
          id: `A${round}`,
          task: 'edit frontend/src/App.tsx',
          output: '<result><status>failed</status></result>',
          toolResults: [],
          status: 'failed',
          error: 'malformed'
        },
        {
          id: `B${round}`,
          task: 'edit frontend/src/Other.tsx',
          output:
            '<result><status>success</status><summary>fine</summary></result>',
          toolResults: [],
          status: 'success'
        }
      ]);
      await handleDelegates(
        [
          { id: `A${round}`, task: 'edit frontend/src/App.tsx', files: [], tools: [] },
          { id: `B${round}`, task: 'edit frontend/src/Other.tsx', files: [], tools: [] }
        ],
        messages,
        counters,
        (e) => events.push(e),
        baseOpts
      );
    }

    // Round-level halt did NOT trip (mixed rounds reset it).
    expect(counters.consecutiveBadRounds).toBe(0);
    // Per-task streak is at 3 for the failing task.
    const streaks = Array.from(counters.perTaskBadStreak.values());
    expect(streaks).toContain(3);
    // Pivot divider was emitted at least once.
    const phases = events.filter(
      (e): e is Extract<TimelineEvent, { kind: 'phase' }> => e.kind === 'phase'
    );
    expect(
      phases.some((p) => p.label.includes('pivot decomposition'))
    ).toBe(true);
  });

  it('clears the streak when the same task signature succeeds in a later round', async () => {
    // Round 1: fail. Round 2: succeed. After round 2, the streak entry
    // for that signature MUST be removed.
    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

    vi.mocked(runSubAgentPool).mockResolvedValueOnce([
      {
        id: 'A',
        task: 'edit foo',
        output: '<result><status>failed</status></result>',
        toolResults: [],
        status: 'failed',
        error: 'malformed'
      }
    ]);
    await handleDelegates(
      [{ id: 'A', task: 'edit foo', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );
    expect(counters.perTaskBadStreak.size).toBe(1);

    vi.mocked(runSubAgentPool).mockResolvedValueOnce([
      {
        id: 'A',
        task: 'edit foo',
        output:
          '<result><status>success</status><summary>good</summary></result>',
        toolResults: [],
        status: 'success'
      }
    ]);
    await handleDelegates(
      [{ id: 'A', task: 'edit foo', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );
    expect(counters.perTaskBadStreak.size).toBe(0);
  });
});

/**
 * T0-3 — aborted workers MUST NOT emit a `subagent-result` event.
 *
 * Their `output` is the empty string by contract; the `subagent-status`
 * event already conveys the `aborted` outcome. Persisting an empty
 * `<result>...` envelope into the JSONL transcript would force the
 * renderer reducer to filter it on every replay.
 */
describe('handleDelegates — aborted workers (T0-3)', () => {
  it('skips subagent-result emission when the worker reports aborted', async () => {
    vi.mocked(runSubAgentPool).mockImplementationOnce(async (_specs, deps) => {
      const run = {
        id: 'A1',
        task: 'cancelled',
        output: '',
        toolResults: [],
        status: 'aborted' as const
      };
      deps.onResult?.(run);
      return [run];
    });

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

    await handleDelegates(
      [{ id: 'A1', task: 'cancelled', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    // The status event still fires.
    const status = events.filter(
      (e): e is Extract<TimelineEvent, { kind: 'subagent-status' }> =>
        e.kind === 'subagent-status'
    );
    expect(status).toHaveLength(1);
    expect(status[0]?.status).toBe('aborted');
    // The result event MUST be absent — no empty envelope persisted.
    expect(events.filter((e) => e.kind === 'subagent-result')).toHaveLength(0);
  });

  it('does not increment consecutiveBadRounds when every worker aborted', async () => {
    vi.mocked(runSubAgentPool).mockImplementationOnce(async (_specs, deps) => {
      const run = {
        id: 'A1',
        task: 'cancelled',
        output: '',
        toolResults: [],
        status: 'aborted' as const
      };
      deps.onResult?.(run);
      return [run];
    });

    const messages: ChatMessage[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 2,
      perTaskBadStreak: new Map()
    };

    const outcome = await handleDelegates(
      [{ id: 'A1', task: 'cancelled', files: [], tools: [] }],
      messages,
      counters,
      () => undefined,
      baseOpts
    );

    expect(outcome).toBe('continue');
    // A round with only aborted workers is not "all bad" — must not
    // advance toward the three-strike halt (would have become 3).
    expect(counters.consecutiveBadRounds).toBe(0);
  });

  it('still emits subagent-result for non-aborted workers (regression guard)', async () => {
    // Belt-and-suspenders: assert the skip branch is scoped to
    // `'aborted'` only. A `failed` worker (no envelope) must still
    // get its result event so the renderer's empty-state path
    // surfaces SOMETHING under "worker output (no envelope)".
    vi.mocked(runSubAgentPool).mockImplementationOnce(async (_specs, deps) => {
      const run = {
        id: 'A1',
        task: 'crashed',
        output: 'I crashed before emitting <result>',
        toolResults: [],
        status: 'failed' as const,
        error: 'crash'
      };
      deps.onResult?.(run);
      return [run];
    });

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

    await handleDelegates(
      [{ id: 'A1', task: 'crashed', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    expect(events.filter((e) => e.kind === 'subagent-result')).toHaveLength(1);
  });
});

/**
 * T1-6 — `partial` status passes through as a distinct lifecycle
 * value instead of collapsing to `done`. Renderers can then surface
 * the softer-tone badge.
 */
describe('handleDelegates — partial status (T1-6)', () => {
  it('passes partial through as a distinct subagent-status value', async () => {
    vi.mocked(runSubAgentPool).mockImplementationOnce(async (_specs, deps) => {
      const run = {
        id: 'A1',
        task: 'half done',
        output:
          '<result><status>partial</status><summary>edits landed but tests fail</summary></result>',
        toolResults: [],
        status: 'partial' as const
      };
      deps.onResult?.(run);
      return [run];
    });

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

    await handleDelegates(
      [{ id: 'A1', task: 'half done', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    const status = events.filter(
      (e): e is Extract<TimelineEvent, { kind: 'subagent-status' }> =>
        e.kind === 'subagent-status'
    );
    expect(status).toHaveLength(1);
    // The pre-T1-6 mapping collapsed `partial` → `done`; the new
    // mapping preserves the distinction.
    expect(status[0]?.status).toBe('partial');
  });
});

/**
 * T1-7 — escalation phase event is COALESCED when 3+ tasks cross
 * the per-task strike threshold in the same round. 1- or 2-task
 * escalations keep the verbose per-task form.
 */
describe('handleDelegates — escalation coalescing (T1-7)', () => {
  it('emits one summary phase event when 3+ tasks escalate together', async () => {
    // Pre-load the per-task counters at threshold-1 for THREE distinct
    // task signatures so a single all-bad round trips the soft escalation
    // for all three at once. Each signature is `taskhead|sortedFiles`.
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map([
        ['edit foo.ts|', 2],
        ['edit bar.ts|', 2],
        ['edit baz.ts|', 2]
      ])
    };

    vi.mocked(runSubAgentPool).mockImplementationOnce(async (_specs, deps) => {
      const runs = [
        {
          id: 'A1',
          task: 'edit foo.ts',
          output: '<result><status>failed</status></result>',
          toolResults: [],
          status: 'failed' as const,
          error: 'malformed'
        },
        {
          id: 'A2',
          task: 'edit bar.ts',
          output: '<result><status>failed</status></result>',
          toolResults: [],
          status: 'failed' as const,
          error: 'malformed'
        },
        {
          id: 'A3',
          task: 'edit baz.ts',
          output: '<result><status>failed</status></result>',
          toolResults: [],
          status: 'failed' as const,
          error: 'malformed'
        }
      ];
      for (const r of runs) deps.onResult?.(r);
      return runs;
    });

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    await handleDelegates(
      [
        { id: 'A1', task: 'edit foo.ts', files: [], tools: [] },
        { id: 'A2', task: 'edit bar.ts', files: [], tools: [] },
        { id: 'A3', task: 'edit baz.ts', files: [], tools: [] }
      ],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    // Pivot phase events. Pre-T1-7 produced one PER task (3 rows);
    // post-T1-7 collapses them into ONE summary row.
    const pivotPhases = events.filter(
      (e): e is Extract<TimelineEvent, { kind: 'phase' }> =>
        e.kind === 'phase' && e.label.includes('pivot decomposition')
    );
    expect(pivotPhases).toHaveLength(1);
    // The summary row enumerates count + max streak.
    expect(pivotPhases[0]!.label).toContain('3 tasks failing');
    expect(pivotPhases[0]!.label).toContain('max 3 rounds');
  });

  it('keeps the per-task verbose form when 1 or 2 tasks escalate', async () => {
    // Two-task escalation — the verbose per-task rows stay so the
    // user gets the full streak + signature head per task.
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map([
        ['edit foo.ts|', 2],
        ['edit bar.ts|', 2]
      ])
    };

    vi.mocked(runSubAgentPool).mockImplementationOnce(async (_specs, deps) => {
      const runs = [
        {
          id: 'A1',
          task: 'edit foo.ts',
          output: '<result><status>failed</status></result>',
          toolResults: [],
          status: 'failed' as const
        },
        {
          id: 'A2',
          task: 'edit bar.ts',
          output: '<result><status>failed</status></result>',
          toolResults: [],
          status: 'failed' as const
        }
      ];
      for (const r of runs) deps.onResult?.(r);
      return runs;
    });

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    await handleDelegates(
      [
        { id: 'A1', task: 'edit foo.ts', files: [], tools: [] },
        { id: 'A2', task: 'edit bar.ts', files: [], tools: [] }
      ],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    const pivotPhases = events.filter(
      (e): e is Extract<TimelineEvent, { kind: 'phase' }> =>
        e.kind === 'phase' && e.label.includes('pivot decomposition')
    );
    // Two tasks → two verbose rows (the verbose form is preserved
    // until the burst threshold of 3+ is hit).
    expect(pivotPhases).toHaveLength(2);
    expect(pivotPhases[0]!.label).toMatch(/Task failing 3 rounds in a row/);
    expect(pivotPhases[1]!.label).toMatch(/Task failing 3 rounds in a row/);
  });
});

describe('handleDelegates — malformed, read-shard warn, host verification', () => {
  it('surfaces malformed subagent-status with envelope reason and attrs on results', async () => {
    vi.mocked(runSubAgentPool).mockImplementationOnce(async (_specs, deps) => {
      const run = {
        id: 'A1',
        task: 'edit without wrap',
        output: 'worker prose but no result envelope',
        toolResults: [],
        status: 'malformed' as const,
        error: 'No <result> envelope'
      };
      deps.onResult?.(run);
      return [run];
    });

    const messages: ChatMessage[] = [];
    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

    await handleDelegates(
      [{ id: 'A1', task: 'edit without wrap', files: [], tools: [] }],
      messages,
      counters,
      (e) => events.push(e),
      baseOpts
    );

    const status = events.find(
      (e): e is Extract<TimelineEvent, { kind: 'subagent-status' }> =>
        e.kind === 'subagent-status'
    );
    expect(status?.status).toBe('malformed');
    expect(status?.message).toMatch(/envelope/i);

    const envelope = messages.find(
      (m) => m.role === 'user' && String(m.content).includes('<subagent_results>')
    );
    expect(envelope?.content).toContain('malformed="true"');
    expect(envelope?.content).toMatch(/reason="missing-envelope"/);
  });

  it('emits a phase warning when most delegates are read-only line shards', async () => {
    vi.mocked(runSubAgentPool).mockResolvedValueOnce([]);

    const events: TimelineEvent[] = [];
    const counters: DelegationCounters = {
      consecutiveBadRounds: 0,
      perTaskBadStreak: new Map()
    };

    await handleDelegates(
      [
        { id: 'r1', task: 'Read src/a.ts lines 1-40', files: ['src/a.ts'], tools: [] },
        { id: 'r2', task: 'Read src/a.ts lines 41-80', files: ['src/a.ts'], tools: [] },
        { id: 'r3', task: 'Read src/a.ts lines 81-120', files: ['src/a.ts'], tools: [] },
        { id: 'c1', task: 'Create src/b.ts', files: ['src/b.ts'], tools: [] }
      ],
      [],
      counters,
      (e) => events.push(e),
      baseOpts
    );

    const warn = events.find(
      (e): e is Extract<TimelineEvent, { kind: 'phase' }> =>
        e.kind === 'phase' && e.label.includes('read-only line-range shards')
    );
    expect(warn).toBeDefined();
    expect(warn!.label).toContain('3/4');
  });

  it('injects host_verification XML from verifyDelegateArtifacts', async () => {
    vi.mocked(verifyDelegateArtifacts).mockResolvedValueOnce([
      { path: 'src/new.ts', ok: true, detail: '42 bytes' }
    ]);
    vi.mocked(formatHostVerificationXml).mockReturnValueOnce(
      '<host_verification>\n<file path="src/new.ts" ok="true">42 bytes</file>\n</host_verification>'
    );
    vi.mocked(runSubAgentPool).mockResolvedValueOnce([
      {
        id: 'A1',
        task: 'Create src/new.ts',
        output: '<result><status>success</status><summary>created</summary></result>',
        toolResults: [],
        status: 'success'
      }
    ]);

    const messages: ChatMessage[] = [];
    await handleDelegates(
      [{ id: 'A1', task: 'Create src/new.ts', files: ['src/new.ts'], tools: [] }],
      messages,
      { consecutiveBadRounds: 0, perTaskBadStreak: new Map() },
      () => undefined,
      baseOpts
    );

    expect(verifyDelegateArtifacts).toHaveBeenCalled();
    const body = messages[0]?.content ?? '';
    expect(body).toContain('<host_verification>');
    expect(body).toContain('src/new.ts');
  });
});
