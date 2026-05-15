/**
 * `SubAgentHeader` — pre-first-byte status suppression.
 *
 * Regression for the screenshot §1 / §2 case where the per-worker
 * status line stayed pinned to `Awaiting first token from <model>…`
 * even after the worker's reasoning panel was visibly streaming
 * tokens below it. The reducer keeps `liveStatus` set across the
 * whole iteration (it only clears on terminal transitions), so the
 * fix lives in the renderer: suppress the line when ANY of this
 * worker's reasoning / text accumulators are open and non-empty.
 *
 * Mirrors `LiveStatusRow.pickLiveStream` so the orchestrator and
 * per-worker surfaces use the same liveness predicate.
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SubAgentHeader } from '@renderer/components/timeline/subagent/SubAgentHeader';
import type { SubAgentSnapshot } from '@renderer/components/timeline/reducer/types';

function makeSnap(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    id: 'S1',
    task: 'analyze providers/',
    files: [],
    missingFiles: [],
    tools: [],
    status: 'running',
    startedAt: 0,
    steps: [],
    fileEdits: [],
    assistantTexts: {},
    reasoningTexts: {},
    iterationOrder: [],
    partialToolCallArgs: {},
    ...overrides
  };
}

const AWAITING = {
  phase: 'awaiting-response',
  label: 'Awaiting first token from deepseek-v4-pro…',
  ts: 100
};

describe('SubAgentHeader — pre-first-byte status suppression', () => {
  it('shows `Awaiting first token…` while no iteration has streamed yet', () => {
    const { container } = render(
      <SubAgentHeader snap={makeSnap({ liveStatus: AWAITING })} />
    );
    expect(container.textContent ?? '').toContain('Awaiting first token from deepseek-v4-pro');
  });

  it('suppresses the status line once a reasoning accumulator opens', () => {
    // Reasoning has started — the in-flight panel inside the run-flow
    // already carries the shimmer cadence, so the header line is
    // redundant and STALE (it still says "Awaiting first token..." but
    // tokens are clearly arriving). Must not render.
    const { container } = render(
      <SubAgentHeader
        snap={makeSnap({
          liveStatus: AWAITING,
          iterationOrder: ['iter-1'],
          reasoningTexts: {
            'iter-1': { id: 'iter-1', text: 'thinking…', done: false, startedAt: 110 }
          }
        })}
      />
    );
    expect(container.textContent ?? '').not.toContain('Awaiting first token');
  });

  it('suppresses the status line once an assistant-text accumulator opens', () => {
    const { container } = render(
      <SubAgentHeader
        snap={makeSnap({
          liveStatus: AWAITING,
          iterationOrder: ['iter-1'],
          assistantTexts: {
            'iter-1': { id: 'iter-1', text: 'about to', done: false, startedAt: 120 }
          }
        })}
      />
    );
    expect(container.textContent ?? '').not.toContain('Awaiting first token');
  });

  it('suppresses the stale label after iteration N closed and BEFORE iteration N+1 connects (§3 regression)', () => {
    // Screenshot §3: iter-1's reasoning panel reads `Thought for 104s`
    // (settled) and the text body has streamed content (also settled),
    // but iter-2 hasn't connected yet. The reducer kept `liveStatus`
    // set to iter-1's `awaiting-response` event from `onConnect`, so
    // a naive "show whenever liveStatus exists" policy would
    // re-surface `Awaiting first token from <model>…` in this gap —
    // contradicting the visibly settled `Thought for 104s` line above
    // it. The freshness predicate (`liveStatus.ts >= latest
    // accumulator startedAt`) keeps the line hidden because iter-1's
    // `awaiting-response` event (ts=110) is older than iter-1's
    // reasoning startedAt (130) and text startedAt (200).
    const { container } = render(
      <SubAgentHeader
        snap={makeSnap({
          liveStatus: { phase: 'awaiting-response', label: AWAITING.label, ts: 110 },
          iterationOrder: ['iter-1'],
          reasoningTexts: {
            'iter-1': { id: 'iter-1', text: 'done', done: true, startedAt: 130, endedAt: 195 }
          },
          assistantTexts: {
            'iter-1': { id: 'iter-1', text: 'wrote stuff', done: true, startedAt: 200 }
          }
        })}
      />
    );
    expect(container.textContent ?? '').not.toContain('Awaiting first token');
  });

  it('re-surfaces the label when a NEW iteration\'s connecting event lands after iter-N closed', () => {
    // Same fixture as the previous test, but `liveStatus.ts` is now
    // newer than every closed accumulator's `startedAt` — that's
    // the signal that iter-2 has actually opened its connection.
    // The line MUST re-surface so the user sees the network-latency
    // phase between iterations.
    const { container } = render(
      <SubAgentHeader
        snap={makeSnap({
          liveStatus: { phase: 'awaiting-response', label: AWAITING.label, ts: 250 },
          iterationOrder: ['iter-1'],
          reasoningTexts: {
            'iter-1': { id: 'iter-1', text: 'done', done: true, startedAt: 130, endedAt: 195 }
          },
          assistantTexts: {
            'iter-1': { id: 'iter-1', text: 'wrote stuff', done: true, startedAt: 200 }
          }
        })}
      />
    );
    expect(container.textContent ?? '').toContain('Awaiting first token');
  });

  it('does not render the status line at all when the worker is no longer running', () => {
    // Pending → status pill shimmer is the SOLE pre-run signal, the
    // header line stays hidden. Already pinned by `shimmer.test.tsx`
    // but re-asserted here so the suppression branch can never widen.
    const { container } = render(
      <SubAgentHeader
        snap={makeSnap({ status: 'pending', liveStatus: AWAITING })}
      />
    );
    expect(container.textContent ?? '').not.toContain('Awaiting first token');
  });

  it('does not render the status line for terminal states', () => {
    const { container } = render(
      <SubAgentHeader
        snap={makeSnap({ status: 'done', liveStatus: AWAITING })}
      />
    );
    expect(container.textContent ?? '').not.toContain('Awaiting first token');
  });
});
