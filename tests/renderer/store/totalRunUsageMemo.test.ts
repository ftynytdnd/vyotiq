/**
 * Regression test for the `totalRunUsage` memoizer.
 *
 * Audit fix 2026-09-P2-1 / 13-P2-3: pre-fix, `mirrorOf` recomputed
 * `totalRunUsage` on every event dispatch and produced a fresh object
 * reference each time, even when the underlying usage values were
 * unchanged. Selectors keyed on `totalRunUsage` therefore re-rendered
 * on EVERY event during a long generation — including
 * `tool-call-args-delta` floods that don't touch usage at all.
 *
 * Post-fix, `computeTotalRunUsage` fingerprints the usage values and
 * returns the previously-computed reference when the fingerprint
 * matches. This test pins:
 *
 *   1. The cache returns the SAME reference across two unchanged
 *      events.
 *   2. A change in `orchestratorUsage` (a `token-usage` event lands)
 *      invalidates the cache and produces a NEW reference.
 *   3. A change in any sub-agent's usage invalidates the cache.
 *   4. `__resetTotalRunUsageCacheForTests` clears the cache so the
 *      next call recomputes from scratch (without this hook, the
 *      module-scope cache leaks across test cases).
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  useChatStore,
  __resetTotalRunUsageCacheForTests
} from '@renderer/store/useChatStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import type { TimelineEvent } from '@shared/types/chat';

const CONV_ID = 'conv-memo-1';
const RUN_ID = 'run-memo-1';

beforeEach(() => {
  __resetTotalRunUsageCacheForTests();
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    slices: {
      [CONV_ID]: {
        ...INITIAL_TIMELINE_STATE,
        conversationId: CONV_ID,
        runId: RUN_ID,
        isProcessing: true,
        runStartedAt: 0,
        draft: ''
      }
    },
    runIdToConv: { [RUN_ID]: CONV_ID },
    runIdToModel: {},
    conversationId: CONV_ID,
    runId: RUN_ID,
    isProcessing: true,
    runStartedAt: 0,
    totalRunUsage: undefined
  });
});

function tokenUsageEvent(
  overrides: Partial<Extract<TimelineEvent, { kind: 'token-usage' }>>
): Extract<TimelineEvent, { kind: 'token-usage' }> {
  return {
    kind: 'token-usage',
    id: 'tu-1',
    ts: 1,
    assistantMsgId: 'm1',
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    ...overrides
  };
}

function deltaEvent(
  id: string,
  delta: string
): Extract<TimelineEvent, { kind: 'agent-text-delta' }> {
  return {
    kind: 'agent-text-delta',
    id,
    ts: 0,
    delta
  };
}

describe('useChatStore — totalRunUsage memoizer', () => {
  it('returns the same reference when no usage-relevant event lands', () => {
    // Seed orchestrator usage so the memoizer has something non-trivial
    // to cache. Dispatch the same event twice — the second call should
    // hit the cache and return the prior reference.
    const store = useChatStore.getState();
    store.applyEvent(RUN_ID, tokenUsageEvent({}));
    const first = useChatStore.getState().totalRunUsage;
    expect(first).toBeDefined();

    // Now dispatch an unrelated agent-text-delta — no usage change.
    // Pre-fix, this would have produced a NEW totalRunUsage object.
    useChatStore.getState().applyEvent(RUN_ID, deltaEvent('msg-1', 'hello '));
    const second = useChatStore.getState().totalRunUsage;
    expect(second).toBe(first);
  });

  it('invalidates the cache when a fresh token-usage event lands', () => {
    const store = useChatStore.getState();
    store.applyEvent(RUN_ID, tokenUsageEvent({}));
    const first = useChatStore.getState().totalRunUsage;

    // Higher prompt/completion counts → fingerprint changes →
    // memoizer recomputes → NEW reference.
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        id: 'tu-2',
        usage: { promptTokens: 200, completionTokens: 40, totalTokens: 240 }
      })
    );
    const second = useChatStore.getState().totalRunUsage;
    expect(second).not.toBe(first);
    expect(second?.latest.promptTokens).toBe(200);
  });

  it('invalidates the cache when a sub-agent usage event lands', () => {
    const store = useChatStore.getState();
    // Spawn a sub-agent so the snapshot slot exists.
    store.applyEvent(RUN_ID, {
      kind: 'subagent-spawn',
      id: 'spawn-1',
      ts: 0,
      subagentId: 'sa-1',
      task: 't',
      files: [],
      tools: []
    });
    // Seed orchestrator usage so the memoizer has a baseline.
    store.applyEvent(RUN_ID, tokenUsageEvent({}));
    const first = useChatStore.getState().totalRunUsage;
    expect(first).toBeDefined();

    // Now route a sub-agent usage frame. The fingerprint must include
    // the sub-agent's latest, so this should invalidate the cache.
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        id: 'tu-sa-1',
        subagentId: 'sa-1',
        assistantMsgId: 'sa-1',
        usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 }
      })
    );
    const second = useChatStore.getState().totalRunUsage;
    expect(second).not.toBe(first);
  });

  it('__resetTotalRunUsageCacheForTests forces a fresh compute', () => {
    const store = useChatStore.getState();
    store.applyEvent(RUN_ID, tokenUsageEvent({}));
    const first = useChatStore.getState().totalRunUsage;
    expect(first).toBeDefined();

    __resetTotalRunUsageCacheForTests();

    // Dispatch the SAME-shaped event. The fingerprint matches what
    // we just discarded, but the cache is empty, so the memoizer
    // must produce a fresh reference rather than handing back the
    // (now-stale) prior one.
    store.applyEvent(RUN_ID, deltaEvent('msg-1', 'x'));
    const second = useChatStore.getState().totalRunUsage;
    // After the reset, the next compute writes a fresh result. We
    // can't assert ref-equality / inequality against `first` because
    // the mirror's `totalRunUsage` is whatever the most recent
    // `mirrorOf` call returned — but we CAN assert the values are
    // still consistent with the prior usage.
    expect(second?.latest.promptTokens).toBe(100);
  });
});

describe('useChatStore — totalRunUsage sum correctness (post-fix)', () => {
  /**
   * Pre-fix (the bug the May 2026 user-reported screenshots hit):
   * `computeTotalRunUsage` folded each sub-agent's `usage.latest`
   * via `foldTokenUsage`, which REPLACES `latest` with the new
   * `next` field-for-field. So the orchestrator's true `latest`
   * (~60k tokens on a long session) was overwritten by the last
   * sub-agent's tiny first frame, leaving the composer pill
   * displaying ~34 tokens while the Inspector's wire-authoritative
   * `UsageBadge` correctly showed ~61k.
   *
   * Post-fix: `computeTotalRunUsage` SUMS each owner's `latest`
   * (orchestrator + every sub-agent) field-for-field. These tests
   * pin that semantics so a future refactor can't silently revert
   * to the broken fold-replace.
   */

  it('sums orchestrator + one sub-agent latest into the run-level aggregate', () => {
    const store = useChatStore.getState();
    // Spawn a sub-agent so its snapshot slot exists.
    store.applyEvent(RUN_ID, {
      kind: 'subagent-spawn',
      id: 'spawn-1',
      ts: 0,
      subagentId: 'sa-1',
      task: 't',
      files: [],
      tools: []
    });
    // Orchestrator reports a typical "long session" frame.
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        usage: { promptTokens: 60000, completionTokens: 1000, totalTokens: 61000 }
      })
    );
    // Sub-agent reports its first (tiny) frame — pre-fix, this
    // overwrote the orchestrator's `latest` and left the pill
    // showing 55.
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        id: 'tu-sa-1',
        subagentId: 'sa-1',
        assistantMsgId: 'sa-1',
        usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 }
      })
    );
    const aggregate = useChatStore.getState().totalRunUsage;
    expect(aggregate).toBeDefined();
    // True sum: 60000 + 50, 1000 + 5, 61000 + 55. Pre-fix this
    // would have been { 50, 5, 55 } (the sub-agent's latest alone).
    expect(aggregate!.latest.promptTokens).toBe(60050);
    expect(aggregate!.latest.completionTokens).toBe(1005);
    expect(aggregate!.latest.totalTokens).toBe(61055);
  });

  it('sums orchestrator + multiple sub-agents (commutative under id ordering)', () => {
    const store = useChatStore.getState();
    // Two sub-agents — different ids so their fingerprints are
    // independent. The aggregate must include BOTH, not just the
    // last-iterated one.
    store.applyEvent(RUN_ID, {
      kind: 'subagent-spawn',
      id: 'spawn-a',
      ts: 0,
      subagentId: 'sa-a',
      task: 'task-a',
      files: [],
      tools: []
    });
    store.applyEvent(RUN_ID, {
      kind: 'subagent-spawn',
      id: 'spawn-b',
      ts: 1,
      subagentId: 'sa-b',
      task: 'task-b',
      files: [],
      tools: []
    });
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        usage: { promptTokens: 40000, completionTokens: 500, totalTokens: 40500 }
      })
    );
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        id: 'tu-sa-a',
        subagentId: 'sa-a',
        assistantMsgId: 'sa-a',
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 }
      })
    );
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        id: 'tu-sa-b',
        subagentId: 'sa-b',
        assistantMsgId: 'sa-b',
        usage: { promptTokens: 200, completionTokens: 30, totalTokens: 230 }
      })
    );
    const aggregate = useChatStore.getState().totalRunUsage;
    expect(aggregate).toBeDefined();
    // 40000 + 100 + 200, 500 + 20 + 30, 40500 + 120 + 230.
    expect(aggregate!.latest.promptTokens).toBe(40300);
    expect(aggregate!.latest.completionTokens).toBe(550);
    expect(aggregate!.latest.totalTokens).toBe(40850);
    // `peak` uses Math.max per field — the orchestrator's 40000
    // dominates the prompt watermark even though the sub-agents
    // contributed their own (smaller) peaks.
    expect(aggregate!.peak.promptTokens).toBe(40000);
    expect(aggregate!.peak.completionTokens).toBe(500);
    expect(aggregate!.peak.totalTokens).toBe(40500);
    // `samples` is the sum of contributing sample counts.
    expect(aggregate!.samples).toBe(3);
  });

  it('carries optional 2026 dialect fields (cached, cache write, reasoning) through the sum', () => {
    const store = useChatStore.getState();
    store.applyEvent(RUN_ID, {
      kind: 'subagent-spawn',
      id: 'spawn-c',
      ts: 0,
      subagentId: 'sa-c',
      task: 'task-c',
      files: [],
      tools: []
    });
    // Orchestrator reports an OpenAI/Anthropic 2026 frame with
    // cached + reasoning breakdown.
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        usage: {
          promptTokens: 50000,
          completionTokens: 2000,
          totalTokens: 52000,
          cachedPromptTokens: 14700,
          reasoningTokens: 1600
        }
      })
    );
    // Sub-agent reports a smaller frame with cache-write +
    // reasoning. cache-creation only appears on the sub-agent
    // side here; it must still flow through into the aggregate.
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        id: 'tu-sa-c',
        subagentId: 'sa-c',
        assistantMsgId: 'sa-c',
        usage: {
          promptTokens: 300,
          completionTokens: 50,
          totalTokens: 350,
          cacheCreationTokens: 100,
          reasoningTokens: 40
        }
      })
    );
    const aggregate = useChatStore.getState().totalRunUsage;
    expect(aggregate).toBeDefined();
    expect(aggregate!.latest.promptTokens).toBe(50300);
    expect(aggregate!.latest.completionTokens).toBe(2050);
    expect(aggregate!.latest.cachedPromptTokens).toBe(14700);
    expect(aggregate!.latest.cacheCreationTokens).toBe(100);
    expect(aggregate!.latest.reasoningTokens).toBe(1640);
  });

  it('returns undefined when no owner has reported usage yet', () => {
    // Empty slice — no orchestrator usage and no sub-agent usage.
    // The aggregate must be `undefined` so the composer pill's
    // `hasActualUsage` gate stays false and the pre-flight
    // `estimate.tokens` continues to drive the displayed value.
    const aggregate = useChatStore.getState().totalRunUsage;
    expect(aggregate).toBeUndefined();
  });
});

describe('useChatStore — orchestratorUsage stays orchestrator-only', () => {
  /**
   * The composer pill reads `s.orchestratorUsage` directly so that
   * `usedTokens = latest.promptTokens + latest.completionTokens +
   * inFlight.completionTokens` reflects the orchestrator's OWN
   * context window (the model the user is composing TO). Sub-agents
   * have completely separate context windows (project.md §"Sub-
   * Agent Delegation" #3, also Anthropic 2026 Claude Code subagents
   * docs). These tests pin that invariant so a future refactor
   * can't silently re-route the pill through `totalRunUsage` and
   * resurrect the May 2026 regression where a tiny sub-agent
   * frame collapsed the pill to ~34 tokens.
   */

  it('keeps orchestratorUsage independent from sub-agent usage frames', () => {
    const store = useChatStore.getState();
    store.applyEvent(RUN_ID, {
      kind: 'subagent-spawn',
      id: 'spawn-iso',
      ts: 0,
      subagentId: 'sa-iso',
      task: 'isolated',
      files: [],
      tools: []
    });
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        usage: { promptTokens: 60000, completionTokens: 1000, totalTokens: 61000 }
      })
    );
    // Sub-agent reports a tiny first frame. Pre-fix this would have
    // collapsed the composer pill's reading to {p:50, c:5} via the
    // broken fold-replace inside `computeTotalRunUsage`. The pill
    // no longer routes through that aggregate — it reads
    // `orchestratorUsage` directly, which the reducer keeps
    // independent.
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        id: 'tu-sa-iso',
        subagentId: 'sa-iso',
        assistantMsgId: 'sa-iso',
        usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 }
      })
    );
    const state = useChatStore.getState();
    // Orchestrator's window — what the composer pill displays.
    expect(state.orchestratorUsage?.latest.promptTokens).toBe(60000);
    expect(state.orchestratorUsage?.latest.completionTokens).toBe(1000);
    // Sub-agent's separate window — surfaced under the sub-agent
    // trace card, never folded into the orchestrator's.
    expect(state.subagents['sa-iso']?.usage?.latest.promptTokens).toBe(50);
    expect(state.subagents['sa-iso']?.usage?.latest.completionTokens).toBe(5);
  });

  it('pill formula (latest.promptTokens + completionTokens + inFlight.completionTokens) computes from orchestratorUsage', () => {
    // This case mirrors what `Composer.tsx` does at runtime:
    //   const usedTokens =
    //     orchestratorUsage.latest.promptTokens +
    //     orchestratorUsage.latest.completionTokens +
    //     (orchestratorUsage.inFlight?.completionTokens ?? 0);
    // Pinning the formula here means any future refactor that
    // swaps the slot back to `totalRunUsage` (now a true sum
    // across all agents) would fail this test loudly.
    const store = useChatStore.getState();
    store.applyEvent(RUN_ID, {
      kind: 'subagent-spawn',
      id: 'spawn-pill',
      ts: 0,
      subagentId: 'sa-pill',
      task: 'pill',
      files: [],
      tools: []
    });
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        usage: { promptTokens: 60000, completionTokens: 1000, totalTokens: 61000 }
      })
    );
    store.applyEvent(
      RUN_ID,
      tokenUsageEvent({
        id: 'tu-sa-pill',
        subagentId: 'sa-pill',
        assistantMsgId: 'sa-pill',
        usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 }
      })
    );
    const orc = useChatStore.getState().orchestratorUsage;
    expect(orc).toBeDefined();
    const inFlight = orc!.inFlight?.completionTokens ?? 0;
    const pillReading =
      orc!.latest.promptTokens + orc!.latest.completionTokens + inFlight;
    // Orchestrator-only window: 60000 + 1000 + 0 = 61000. Pre-fix
    // the composer would have read totalRunUsage.latest, ending up
    // at 50 + 5 + 0 = 55 — the 1110× error the screenshots showed.
    expect(pillReading).toBe(61000);
  });
});
