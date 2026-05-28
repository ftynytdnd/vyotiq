import { describe, expect, it } from 'vitest';
import { reviewSessionBlocksSend } from '../../../src/shared/checkpoints/reviewSessionBlocksSend.js';
import type { ReviewSession } from '@shared/types/checkpoint.js';

const base: ReviewSession = {
  conversationId: 'c1',
  workspaceId: 'w1',
  startedAt: 1,
  updatedAt: 1,
  comments: []
};

describe('reviewSessionBlocksSend', () => {
  it('blocks on overall request_changes', () => {
    expect(reviewSessionBlocksSend({ ...base, decision: 'request_changes' })).toBe(true);
  });

  it('blocks on per-file request_changes', () => {
    expect(
      reviewSessionBlocksSend({
        ...base,
        fileDecisions: { 'a.ts': 'approve', 'b.ts': 'request_changes' }
      })
    ).toBe(true);
  });

  it('does not block on approve only', () => {
    expect(
      reviewSessionBlocksSend({
        ...base,
        decision: 'approve',
        fileDecisions: { 'a.ts': 'approve' }
      })
    ).toBe(false);
  });
});
