/**
 * `replayTranscript` — `history-summary` masking. Audit fix §2.2.
 *
 * Locks down the contract the runtime depends on:
 *
 *   1. Events whose id appears in some `history-summary.replacedEventIds`
 *      are skipped during replay — their model-visible projection
 *      never reaches `messages[]`.
 *   2. The `history-summary` event itself emits a synthetic `user`
 *      message wrapped in `<history_summary>…</history_summary>` at
 *      its position in the event stream.
 *   3. Events NOT in any mask reach `messages[]` unchanged. The
 *      orchestrator's reconstructed memory after summarization equals
 *      `[system?, summary, recent turns…, current prompt]`.
 *   4. Multiple `history-summary` events compose: every replaced id
 *      across the whole transcript is masked.
 *
 * The fixtures use real `TimelineEvent` shapes so any future change to
 * the union immediately surfaces here.
 */

import { describe, expect, it } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat';
import { replayTranscript } from '@main/orchestrator/replay/replayTranscript';

function userPrompt(id: string, content: string, ts = 0): TimelineEvent {
  return { kind: 'user-prompt', id, ts, content };
}

function textDelta(id: string, delta: string, ts = 0): TimelineEvent {
  return { kind: 'agent-text-delta', id, ts, delta };
}

function textEnd(id: string, ts = 0): TimelineEvent {
  return { kind: 'agent-text-end', id, ts };
}

function historySummary(
  id: string,
  summary: string,
  replacedEventIds: string[],
  ts = 0
): TimelineEvent {
  return {
    kind: 'history-summary',
    id,
    ts,
    summary,
    replacedEventIds
  };
}

describe('replayTranscript — history-summary masking (§2.2)', () => {
  it('skips events whose id appears in replacedEventIds', () => {
    const events: TimelineEvent[] = [
      userPrompt('u1', 'first prompt', 100),
      textDelta('a1', 'old reply', 110),
      textEnd('a1', 120),
      historySummary('h1', 'summary of the first turn', ['u1', 'a1'], 130),
      userPrompt('u2', 'second prompt', 200),
      textDelta('a2', 'new reply', 210),
      textEnd('a2', 220)
    ];
    const messages = replayTranscript(events);
    // Expected: synthetic summary user message + new turn pair.
    // The first prompt + first assistant reply are masked.
    const userBodies = messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));
    // The synthetic summary is wrapped in `<history_summary>…`.
    expect(userBodies.some((c) => c.includes('<history_summary>'))).toBe(true);
    expect(userBodies.some((c) => c.includes('summary of the first turn'))).toBe(true);
    // The masked first prompt does NOT survive into the model
    // memory.
    expect(userBodies.some((c) => c.includes('first prompt'))).toBe(false);
    // The second turn's user prompt is preserved verbatim.
    expect(userBodies.some((c) => c.includes('second prompt'))).toBe(true);
    // The second assistant turn's text is folded into a single
    // assistant message.
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('new reply');
  });

  it('places the synthetic summary at the position of the history-summary event', () => {
    // Order matters: the synthetic message lands BEFORE the next
    // user prompt so the orchestrator sees `…summary, new prompt`
    // rather than `…new prompt, summary`.
    const events: TimelineEvent[] = [
      userPrompt('u1', 'oldest', 100),
      textDelta('a1', 'old reply', 110),
      textEnd('a1', 120),
      historySummary('h1', 'condensed', ['u1', 'a1'], 130),
      userPrompt('u2', 'live', 200)
    ];
    const messages = replayTranscript(events);
    const userBodies = messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));
    // Order: summary first, then live.
    const summaryIdx = userBodies.findIndex((c) => c.includes('<history_summary>'));
    const liveIdx = userBodies.findIndex((c) => c.includes('live'));
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(liveIdx).toBeGreaterThan(summaryIdx);
  });

  it('composes multiple history-summary events (every masked id is skipped)', () => {
    const events: TimelineEvent[] = [
      userPrompt('u1', 'first', 100),
      historySummary('h1', 'summary 1', ['u1'], 110),
      userPrompt('u2', 'second', 200),
      historySummary('h2', 'summary 2', ['u2'], 210),
      userPrompt('u3', 'live', 300)
    ];
    const messages = replayTranscript(events);
    const userBodies = messages
      .filter((m) => m.role === 'user')
      .map((m) => (typeof m.content === 'string' ? m.content : ''));
    expect(userBodies.some((c) => c.includes('first'))).toBe(false);
    expect(userBodies.some((c) => c.includes('second'))).toBe(false);
    expect(userBodies.filter((c) => c.includes('<history_summary>')).length).toBe(2);
    expect(userBodies.some((c) => c.includes('summary 1'))).toBe(true);
    expect(userBodies.some((c) => c.includes('summary 2'))).toBe(true);
    expect(userBodies.some((c) => c.includes('live'))).toBe(true);
  });

  it('is a no-op when no history-summary events exist (legacy transcripts)', () => {
    const events: TimelineEvent[] = [
      userPrompt('u1', 'hello', 100),
      textDelta('a1', 'world', 110),
      textEnd('a1', 120)
    ];
    const messages = replayTranscript(events);
    expect(messages.find((m) => m.role === 'user')?.content).toContain('hello');
    expect(messages.find((m) => m.role === 'assistant')?.content).toBe('world');
  });
});
