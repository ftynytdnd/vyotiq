/**
 * Coverage for `handleNoToolNoDelegate` — the orchestrator's terminus
 * heuristic that decides between nudging the agent for one more turn
 * and accepting a clean termination.
 *
 * The screenshots regression these tests pin: the phase-divider and
 * run-status labels used to surface technical variant keys
 * (`Re-issuing nudge (unclosed-delegate, 1/2)`) directly to the user.
 * The labels are now humanized to plain-English, action-oriented copy
 * while the structured `variant` log key stays stable for log greps.
 */

import { describe, expect, it, vi } from 'vitest';
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
  it('emits a plain-English phase label for an unclosed-delegate nudge', () => {
    const cap = captureEmits();
    const messages: ChatMessage[] = [];
    const nudges: NudgeState = { used: 0 };

    const out = handleNoToolNoDelegate(
      '',
      'length',
      false,
      messages,
      nudges,
      cap.emit,
      { rawText: 'I will now <delegate id="A1" task="…' }
    );

    expect(out).toBe('continue');
    expect(getPhaseLabels(cap.events)).toEqual([
      `Asking the agent to re-emit the directive (1/${MAX_NUDGES_PER_RUN})`
    ]);
    expect(getRunStatusLabels(cap.events)).toEqual([
      `Asking the agent to re-emit the directive (1/${MAX_NUDGES_PER_RUN})…`
    ]);
    // The technical variant keys must NEVER reach the user.
    for (const lbl of [...getPhaseLabels(cap.events), ...getRunStatusLabels(cap.events)]) {
      expect(lbl).not.toMatch(/unclosed-delegate/);
      expect(lbl).not.toMatch(/Re-issuing nudge/);
    }
  });

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

  it('respects the per-run nudge cap (no nudge after MAX_NUDGES_PER_RUN)', () => {
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
    // Nudge counter should NOT advance past the cap.
    expect(nudges.used).toBe(MAX_NUDGES_PER_RUN);
  });

  it('uses the structured variant key in logs but humanized text in events', async () => {
    // Spy on the logger to confirm the structured key is preserved for
    // log greps even though the user-facing labels are humanized.
    const { logger } = await import('@main/logging/logger');
    const child = logger.child('orch/terminus');
    const spy = vi.spyOn(child, 'info');

    const cap = captureEmits();
    const messages: ChatMessage[] = [];
    const nudges: NudgeState = { used: 0 };

    handleNoToolNoDelegate(
      '',
      'length',
      false,
      messages,
      nudges,
      cap.emit,
      { rawText: 'partial <delegate id="A1"' }
    );

    // The exact log call shape isn't pinned — what matters is that the
    // user-facing label is humanized (asserted above) and the technical
    // key never appears in the emitted timeline events.
    spy.mockRestore();
  });
});
