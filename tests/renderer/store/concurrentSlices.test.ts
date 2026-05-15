/**
 * Concurrent-slice regression — pins the renderer-side guarantee that
 * many runs across many conversations stream into their own slices
 * without stepping on each other or on the active mirror.
 *
 * The chat store keeps a per-conversation slice plus a `runIdToConv`
 * dispatch table. The mirror exposes the active slice's shape via
 * top-level fields. Critical invariants this test pins:
 *
 *   1. Two runs (different conversations, different runIds) can be
 *      live simultaneously without their event streams cross-feeding.
 *   2. Switching the active conversation does NOT cancel or disturb
 *      an in-flight run on a now-inactive slice.
 *   3. `finishRun` only clears the targeted slice's `isProcessing`
 *      flag and prunes only that run's mapping entry — other slices
 *      and their mappings are untouched.
 *   4. The active mirror reflects the slice that is currently active
 *      AT THE TIME the event is processed, not whichever slice
 *      happens to receive the next event.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useChatStore } from '@renderer/store/useChatStore';
import { chatSliceFixture } from '../../_fixtures/chatSlice';

beforeEach(() => {
  useChatStore.setState({
    slices: {},
    runIdToConv: {},
    events: [],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
});

describe('useChatStore — concurrent slices stay isolated', () => {
  it('events for run-A never leak into slice-B and vice versa', () => {
    // Seed two slices and their dispatch entries directly — this
    // mirrors what `send()` does post pre-create-on-send fix.
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: true,
          runStartedAt: 1
        }),
        'conv-B': chatSliceFixture({
          conversationId: 'conv-B',
          runId: 'run-B',
          isProcessing: true,
          runStartedAt: 2
        })
      },
      runIdToConv: { 'run-A': 'conv-A', 'run-B': 'conv-B' },
      conversationId: 'conv-A',
      runId: 'run-A',
      isProcessing: true,
      runStartedAt: 1,
      events: [],
      assistantTexts: {},
      reasoningTexts: {},
      subagents: {},
      orchestratorUsage: undefined
    });

    const { applyEvent } = useChatStore.getState();
    applyEvent('run-A', { kind: 'user-prompt', id: 'a-1', ts: 10, content: 'A says hi' });
    applyEvent('run-B', { kind: 'user-prompt', id: 'b-1', ts: 11, content: 'B says hi' });
    applyEvent('run-A', { kind: 'agent-thought', id: 'a-2', ts: 12, content: 'A thinks' });
    applyEvent('run-B', { kind: 'agent-thought', id: 'b-2', ts: 13, content: 'B thinks' });

    const s = useChatStore.getState();
    const aIds = s.slices['conv-A']!.events.map((e) => e.id);
    const bIds = s.slices['conv-B']!.events.map((e) => e.id);

    expect(aIds).toEqual(['a-1', 'a-2']);
    expect(bIds).toEqual(['b-1', 'b-2']);

    // Active mirror reflects conv-A (the active slice at time of
    // dispatch). The inactive slice's two events did NOT bleed into
    // the mirror.
    expect(s.events.map((e) => e.id)).toEqual(['a-1', 'a-2']);
  });

  it('switching active conversation preserves the inactive slice processing flags', () => {
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: true,
          runStartedAt: 1
        }),
        'conv-B': chatSliceFixture({
          conversationId: 'conv-B',
          runId: 'run-B',
          isProcessing: true,
          runStartedAt: 2
        })
      },
      runIdToConv: { 'run-A': 'conv-A', 'run-B': 'conv-B' },
      conversationId: 'conv-A',
      runId: 'run-A',
      isProcessing: true,
      runStartedAt: 1
    });

    // Switch from A to B mid-run. Mirror flips, but the conv-A slice
    // must stay processing — the user simply changed views.
    useChatStore.getState().setActiveConversation('conv-B');
    let s = useChatStore.getState();
    expect(s.conversationId).toBe('conv-B');
    expect(s.isProcessing).toBe(true);
    expect(s.runId).toBe('run-B');
    expect(s.slices['conv-A']!.isProcessing).toBe(true);
    expect(s.slices['conv-A']!.runId).toBe('run-A');

    // Switch back — conv-A's runId/runStartedAt are still intact.
    useChatStore.getState().setActiveConversation('conv-A');
    s = useChatStore.getState();
    expect(s.conversationId).toBe('conv-A');
    expect(s.runId).toBe('run-A');
    expect(s.runStartedAt).toBe(1);
    // conv-B slice is still running in the background.
    expect(s.slices['conv-B']!.isProcessing).toBe(true);
  });

  it('finishRun on one slice does not disturb the other slice or mapping', () => {
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: true,
          runStartedAt: 1
        }),
        'conv-B': chatSliceFixture({
          conversationId: 'conv-B',
          runId: 'run-B',
          isProcessing: true,
          runStartedAt: 2
        })
      },
      runIdToConv: { 'run-A': 'conv-A', 'run-B': 'conv-B' },
      conversationId: 'conv-A',
      runId: 'run-A',
      isProcessing: true,
      runStartedAt: 1
    });

    useChatStore.getState().finishRun('run-A');

    const s = useChatStore.getState();
    expect(s.slices['conv-A']!.isProcessing).toBe(false);
    expect(s.slices['conv-A']!.runId).toBeNull();
    // conv-B untouched.
    expect(s.slices['conv-B']!.isProcessing).toBe(true);
    expect(s.slices['conv-B']!.runId).toBe('run-B');
    // Mapping pruned only for the finished run.
    expect(s.runIdToConv).toEqual({ 'run-B': 'conv-B' });
    // Active mirror (conv-A) reflects the finish.
    expect(s.isProcessing).toBe(false);
    expect(s.runId).toBeNull();
  });

  it('events for an unmapped runId are dropped without throwing or polluting any slice', () => {
    useChatStore.setState({
      slices: {
        'conv-A': chatSliceFixture({
          conversationId: 'conv-A',
          runId: 'run-A',
          isProcessing: true,
          runStartedAt: 1
        })
      },
      runIdToConv: { 'run-A': 'conv-A' },
      conversationId: 'conv-A',
      runId: 'run-A',
      isProcessing: true,
      runStartedAt: 1
    });

    // Late event for a run that was already pruned (or never mapped).
    expect(() =>
      useChatStore.getState().applyEvent('run-ghost', {
        kind: 'user-prompt',
        id: 'ghost-1',
        ts: 99,
        content: 'no destination'
      })
    ).not.toThrow();

    const s = useChatStore.getState();
    expect(s.slices['conv-A']!.events).toHaveLength(0);
    expect(Object.keys(s.slices)).toEqual(['conv-A']);
  });
});
