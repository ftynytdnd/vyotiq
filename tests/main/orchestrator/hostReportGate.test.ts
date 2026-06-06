import { describe, expect, it } from 'vitest';
import {
  buildHostReportGatePayload,
  isHostReportGateNoAnswer
} from '@main/orchestrator/loop/hostReportGate';

describe('hostReportGate', () => {
  it('builds a single yes/no question payload', () => {
    const payload = buildHostReportGatePayload(2, 3);
    expect(payload.questions).toHaveLength(1);
    expect(payload.questions[0]?.options).toHaveLength(2);
    expect(payload.questions[0]?.prompt).toContain('3 file');
    expect(payload.questions[0]?.prompt).toContain('2 path');
  });

  it('detects No answers', () => {
    const payload = buildHostReportGatePayload(1, 1);
    expect(
      isHostReportGateNoAnswer(payload, [
        { questionId: payload.questions[0]!.id, selectedOptionIds: ['no'] }
      ])
    ).toBe(true);
    expect(
      isHostReportGateNoAnswer(payload, [
        { questionId: payload.questions[0]!.id, selectedOptionIds: ['yes'] }
      ])
    ).toBe(false);
  });
});
