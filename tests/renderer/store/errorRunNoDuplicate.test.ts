/**
 * Regression for audit finding F-024 — the AgentV catch path emits a
 * `kind:'error'` timeline event AND calls `deps.onError(msg)`, which
 * the renderer translates into TWO renderer-side actions:
 *   1. `applyEvent(runId, errorEvent)` — fired by `vyotiq.chat.onEvent`
 *      when the emit reaches the renderer. The reducer prepends the
 *      authoritative error row.
 *   2. `errorRun(runId, message)` — fired by `vyotiq.chat.onError`
 *      when the run-level termination signal arrives. Pre-fix, this
 *      ALSO injected a `kind:'error'` row, producing two visually
 *      identical errors with different ids/timestamps.
 *
 * The fix: `errorRun` only clears the slice's `isProcessing` / `runId`
 * fields and drops the dispatch-table mapping entry; it does NOT
 * inject a timeline event. This test pins that contract.
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
    orchestratorUsage: undefined,
    conversationId: null,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
});

describe('useChatStore.errorRun — single error row per run failure', () => {
  it('produces ONE error row when AgentV emits an error event then calls onError', () => {
    // Simulate a run in progress.
    useChatStore.setState({
      slices: {
        'conv-X': chatSliceFixture({
          conversationId: 'conv-X',
          runId: 'run-X',
          isProcessing: true,
          runStartedAt: 1
        })
      },
      runIdToConv: { 'run-X': 'conv-X' },
      conversationId: 'conv-X',
      runId: 'run-X',
      isProcessing: true,
      runStartedAt: 1
    });

    const { applyEvent, errorRun } = useChatStore.getState();

    // Step 1 — chat:event delivers the authoritative error row first
    // (matches AgentV.ts catch ordering: emit → onError).
    applyEvent('run-X', {
      kind: 'error',
      id: 'err-1',
      ts: 100,
      message: 'Provider failed'
    });

    // Step 2 — chat:error delivers the run-level termination signal.
    errorRun('run-X', 'Provider failed');

    const s = useChatStore.getState();
    const errorEvents = s.slices['conv-X']!.events.filter((e) => e.kind === 'error');

    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.id).toBe('err-1');
    expect((errorEvents[0] as { message: string }).message).toBe('Provider failed');

    // Run-state slots got cleared.
    expect(s.slices['conv-X']!.isProcessing).toBe(false);
    expect(s.slices['conv-X']!.runId).toBeNull();
    expect(s.slices['conv-X']!.runStartedAt).toBeNull();

    // Dispatch mapping pruned.
    expect(s.runIdToConv).toEqual({});

    // Active mirror (conv-X is active) reflects the cleared slot.
    expect(s.isProcessing).toBe(false);
    expect(s.runId).toBeNull();
  });

  it('errorRun on an unmapped runId is a silent no-op', () => {
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

    expect(() =>
      useChatStore.getState().errorRun('run-ghost', 'whatever')
    ).not.toThrow();

    // conv-A untouched.
    const s = useChatStore.getState();
    expect(s.slices['conv-A']!.isProcessing).toBe(true);
    expect(s.slices['conv-A']!.runId).toBe('run-A');
    expect(s.runIdToConv).toEqual({ 'run-A': 'conv-A' });
    expect(s.slices['conv-A']!.events).toHaveLength(0);
  });
});
