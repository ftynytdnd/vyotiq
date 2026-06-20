import { describe, expect, it } from 'vitest';
import { shouldUseAskUserOverlay, ASK_USER_OVERLAY_MIN_QUESTIONS } from '@shared/askUser/askUserOverlay.js';

describe('shouldUseAskUserOverlay', () => {
  it('uses overlay for host report gate', () => {
    expect(
      shouldUseAskUserOverlay({
        source: 'host-report-gate',
        payload: { questions: [{ id: 'q1', prompt: 'Q?', options: [{ id: 'a', label: 'A' }] }] }
      })
    ).toBe(true);
  });

  it('uses overlay when question count meets threshold', () => {
    const payload = {
      questions: Array.from({ length: ASK_USER_OVERLAY_MIN_QUESTIONS }, (_, i) => ({
        id: `q${i}`,
        prompt: `Q${i}`,
        options: [{ id: 'a', label: 'A' }]
      }))
    };
    expect(shouldUseAskUserOverlay({ payload })).toBe(true);
  });

  it('uses inline form for one or two questions', () => {
    const payload = {
      questions: [
        { id: 'q1', prompt: 'Q1', options: [{ id: 'a', label: 'A' }] },
        { id: 'q2', prompt: 'Q2', options: [{ id: 'b', label: 'B' }] }
      ]
    };
    expect(shouldUseAskUserOverlay({ payload })).toBe(false);
  });
});
