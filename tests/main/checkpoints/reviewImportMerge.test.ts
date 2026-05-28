import { describe, expect, it } from 'vitest';
import {
  mergeReviewComments,
  mergeReviewSessions,
  reviewSessionHasContent
} from '../../../src/shared/checkpoints/reviewImportMerge.js';
import type { ReviewSession } from '@shared/types/checkpoint.js';

const emptyShell = (id: string): ReviewSession => ({
  conversationId: id,
  workspaceId: 'ws-1',
  startedAt: 1,
  updatedAt: 1,
  comments: []
});

describe('reviewSessionHasContent', () => {
  it('is false for an empty ensureReview shell', () => {
    expect(reviewSessionHasContent(emptyShell('c1'))).toBe(false);
  });

  it('is true when comments exist', () => {
    expect(
      reviewSessionHasContent({
        ...emptyShell('c1'),
        comments: [{ id: 'x', filePath: 'a.ts', body: 'note', ts: 2 }]
      })
    ).toBe(true);
  });
});

describe('mergeReviewComments', () => {
  it('reassigns duplicate comment ids from incoming', () => {
    const existing = [{ id: 'dup', filePath: 'a.ts', body: 'local', ts: 1 }];
    const incoming = [{ id: 'dup', filePath: 'b.ts', body: 'imported', ts: 2 }];
    let n = 0;
    const merged = mergeReviewComments(existing, incoming, () => `new-${++n}`);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.id).toBe('dup');
    expect(merged[1]?.id).toBe('new-1');
    expect(merged[1]?.body).toBe('imported');
  });
});

describe('mergeReviewSessions', () => {
  it('keeps local comments and overlays per-file decisions', () => {
    const existing: ReviewSession = {
      ...emptyShell('target'),
      comments: [{ id: 'c1', filePath: 'local.ts', body: 'keep', ts: 1 }],
      fileDecisions: { 'local.ts': 'approve' },
      reviewerLabel: 'Local'
    };
    const incoming: ReviewSession = {
      ...emptyShell('other'),
      decision: 'request_changes',
      fileDecisions: { 'remote.ts': 'request_changes' },
      reviewerLabel: 'Remote'
    };

    const merged = mergeReviewSessions(existing, incoming, {
      conversationId: 'target',
      workspaceId: 'ws-1'
    }, () => 'new-id');

    expect(merged.comments).toHaveLength(1);
    expect(merged.comments[0]?.body).toBe('keep');
    expect(merged.fileDecisions).toEqual({
      'local.ts': 'approve',
      'remote.ts': 'request_changes'
    });
    expect(merged.decision).toBe('request_changes');
    expect(merged.reviewerLabel).toBe('Remote');
  });
});
