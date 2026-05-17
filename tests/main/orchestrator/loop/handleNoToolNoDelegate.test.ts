/**
 * Coverage for `handleNoToolNoDelegate` — the orchestrator's terminus
 * heuristic that decides between nudging the agent for one more turn
 * and accepting a clean termination.
 *
 * Pinned contracts:
 *   - The single nudge variant (`reasoning-only`) emits a humanized
 *     phase + run-status label; the technical variant key never
 *     reaches the user.
 *   - A clean substantive answer terminates without nudging.
 *   - A colon-handoff narration ("Now I'll delegate …:") is a CLEAN
 *     terminus — the narration-loop pathology is a transport-layer
 *     concern (Ollama `reasoning_content` round-trip), not a host
 *     heuristic concern.
 *   - A turn that ends with a partial / unclosed `<delegate ...` tag
 *     is also a CLEAN terminus — the parser already silently ignores
 *     the partial, the renderer-side strip masks it, and the
 *     `<run_state>` envelope already gives the model the recovery
 *     signal. The earlier host-side re-emit nudge was redundant
 *     machinery and was removed.
 *   - The `MAX_NUDGES_PER_RUN` cap is honored — once the budget is
 *     exhausted on a still-flagged turn, a visible `error` event
 *     fires (silent-stoppage backstop).
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat';
import {
  handleNoToolNoDelegate,
  MAX_NUDGES_PER_RUN,
  type NudgeState
} from '@main/orchestrator/loop/handleNoToolNoDelegate';

interface Captured {
  events: TimelineEvent[];
  emit: (e: TimelineEvent) => void;
}

function captureEmits(): Captured {
  const events: TimelineEvent[] = [];
  return {
    events,
    emit: (e) => {
      events.push(e);
    }
  };
}

function getPhaseLabels(events: TimelineEvent[]): string[] {
  return events
    .filter((e): e is Extract<TimelineEvent, { kind: 'phase' }> => e.kind === 'phase')
    .map((e) => e.label);
}

function getRunStatusLabels(events: TimelineEvent[]): string[] {
  return events
    .filter(
      (e): e is Extract<TimelineEvent, { kind: 'run-status' }> => e.kind === 'run-status'
    )
    .map((e) => e.label);
}

describe('handleNoToolNoDelegate — humanized nudge labels', () => {
  it('emits a plain-English phase label for a reasoning-only nudge', () => {
    const cap = captureEmits();
    const messages: ChatMessage[] = [];
    const nudges: NudgeState = { used: 0 };

    const out = handleNoToolNoDelegate(
      '',
      'stop',
      true, // hadReasoning
      messages,
      nudges,
      cap.emit
    );

    expect(out).toBe('continue');
    expect(getPhaseLabels(cap.events)).toEqual([
      `Asking the agent to act after silent reasoning (1/${MAX_NUDGES_PER_RUN})`
    ]);
    expect(getRunStatusLabels(cap.events)).toEqual([
      `Asking the agent to act after silent reasoning (1/${MAX_NUDGES_PER_RUN})…`
    ]);
    for (const lbl of [...getPhaseLabels(cap.events), ...getRunStatusLabels(cap.events)]) {
      expect(lbl).not.toMatch(/reasoning-only/);
    }
  });

  it('terminates cleanly (no nudge) on a substantive text turn', () => {
    const cap = captureEmits();
    const messages: ChatMessage[] = [];
    const nudges: NudgeState = { used: 0 };

    const out = handleNoToolNoDelegate(
      'Here is the answer.',
      'stop',
      false,
      messages,
      nudges,
      cap.emit
    );

    expect(out).toBe('terminate');
    expect(getPhaseLabels(cap.events)).toEqual([]);
    expect(getRunStatusLabels(cap.events)).toEqual([]);
    expect(nudges.used).toBe(0);
  });

  it('terminates cleanly on a colon-handoff narration (transport-layer concern, not heuristic)', () => {
    // The narration loop pathology was caused by the Ollama transport
    // stripping `reasoning_content` on outgoing assistant messages,
    // not by the heuristic missing a regex case. With the round-trip
    // fixed, a colon-handoff narration is a clean terminus and the
    // model carries its plan via the reasoning channel.
    const cap = captureEmits();
    const messages: ChatMessage[] = [];
    const nudges: NudgeState = { used: 0 };

    const out = handleNoToolNoDelegate(
      "Now I'll delegate multiple parallel agents to analyze different aspects of the codebase:",
      'stop',
      true, // model produced reasoning along with the announcement
      messages,
      nudges,
      cap.emit
    );

    expect(out).toBe('terminate');
    expect(getPhaseLabels(cap.events)).toEqual([]);
    expect(cap.events.filter((e) => e.kind === 'error')).toHaveLength(0);
  });

  it('terminates cleanly on a turn whose buffer ends with an unclosed `<delegate ...` tag', () => {
    // Re-emit nudge surface removed: the parser silently ignores
    // partial directives, the renderer strip masks them, and the
    // model self-regulates via `<run_state>` and `finish_reason`.
    // The host accepts the terminus and the next user prompt will
    // bring fresh context.
    const cap = captureEmits();
    const messages: ChatMessage[] = [];
    const nudges: NudgeState = { used: 0 };

    const out = handleNoToolNoDelegate(
      // The cleanText is what the strip already collapsed; the
      // partial XML never reaches the heuristic anymore.
      '',
      'length',
      false,
      messages,
      nudges,
      cap.emit
    );

    expect(out).toBe('terminate');
    // No nudge, no re-emit ask, no extra messages pushed.
    expect(messages).toHaveLength(0);
    expect(nudges.used).toBe(0);
    expect(getPhaseLabels(cap.events)).not.toContain(
      `Asking the agent to re-emit the directive (1/${MAX_NUDGES_PER_RUN})`
    );
    // The empty-turn breadcrumb still fires (M-08 contract).
    const phases = getPhaseLabels(cap.events);
    expect(phases.some((l) => l.includes('finish_reason=length'))).toBe(true);
  });

  it('respects the per-run nudge cap and surfaces a visible error when budget exhausted on a flagged turn', () => {
    // Backstop: when the nudge budget is exhausted on a still-flagged
    // pattern, the loop must surface a visible `error` event so the
    // chat doesn't hang. Mirrors how three-strike halts elsewhere
    // signal failure.
    const cap = captureEmits();
    const messages: ChatMessage[] = [];
    const nudges: NudgeState = { used: MAX_NUDGES_PER_RUN };

    const out = handleNoToolNoDelegate(
      '',
      'stop',
      true,
      messages,
      nudges,
      cap.emit
    );

    expect(out).toBe('terminate');
    expect(getPhaseLabels(cap.events)).toEqual([]);
    // Nudge counter does not advance past the cap.
    expect(nudges.used).toBe(MAX_NUDGES_PER_RUN);
    // Visible error must surface so the user sees why the run halted.
    const errors = cap.events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { message: string }).message).toMatch(/<delegate/);
    expect((errors[0] as { message: string }).message).toMatch(/nudges/);
  });

  it('does NOT emit an `error` event when the nudge budget is exhausted on a clean terminus', () => {
    // Clean substantive answer — no nudge needed, no error to surface.
    const cap = captureEmits();
    const messages: ChatMessage[] = [];
    const nudges: NudgeState = { used: MAX_NUDGES_PER_RUN };

    const out = handleNoToolNoDelegate(
      'Here is the final answer.',
      'stop',
      false,
      messages,
      nudges,
      cap.emit
    );

    expect(out).toBe('terminate');
    expect(cap.events.filter((e) => e.kind === 'error')).toHaveLength(0);
    expect(cap.events.filter((e) => e.kind === 'phase')).toHaveLength(0);
  });

  it('halts after a SINGLE nudge on a hopeless-reasoning turn (reasoning-only repeats)', () => {
    // Regression for the May 16 capture: two back-to-back reasoning-
    // only nudges with `cleanTextLen=0` each produced another empty
    // turn (model emitted reasoning but no visible output again).
    // Both nudges burned for nothing before the loop halted. The
    // hopeless-reasoning detector collapses that to a single nudge
    // then immediately halts on the next still-flagged turn.
    const cap = captureEmits();
    const messages: ChatMessage[] = [];
    const nudges: NudgeState = { used: 0 };

    // First call: reasoning-only empty turn (hadReasoning=true), finish=stop → ONE nudge.
    const first = handleNoToolNoDelegate(
      '',
      'stop',
      true, // hadReasoning — triggers `reasoning-only`
      messages,
      nudges,
      cap.emit
    );
    expect(first).toBe('continue');
    expect(nudges.used).toBe(1);

    // Second call with the same hopeless-reasoning pattern: must halt
    // immediately instead of burning the second nudge.
    cap.events.length = 0;
    const second = handleNoToolNoDelegate(
      '',
      'stop',
      true,
      messages,
      nudges,
      cap.emit
    );
    expect(second).toBe('terminate');
    expect(nudges.used).toBe(1); // budget was 1; no further increments
    const errors = cap.events.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    // Error message names the nudge count rather than the constant.
    expect((errors[0] as { message: string }).message).toMatch(/1 nudge/);
  });
});
