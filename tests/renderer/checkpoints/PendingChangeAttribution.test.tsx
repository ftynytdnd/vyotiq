/**
 * PendingChangeAttribution — review decision badges on pending rows.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PendingChangeAttribution } from '@renderer/components/checkpoints/shared/PendingChangeAttribution.js';
import type { PendingChange } from '@shared/types/checkpoint.js';

const baseChange: PendingChange = {
  entryId: 'e-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  filePath: 'src/a.ts',
  kind: 'modify',
  additions: 1,
  deletions: 0,
  createdAt: 1
};

vi.mock('@renderer/store/useCheckpointsStore.js', () => ({
  reviewCacheKey: (ws: string, cid: string) => `${ws}:${cid}`,
  useCheckpointsStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      reviewByConversation: {
        'ws-1:conv-1': {
          conversationId: 'conv-1',
          workspaceId: 'ws-1',
          startedAt: 1,
          updatedAt: 1,
          reviewerLabel: 'Reviewer One',
          fileDecisions: { 'src/a.ts': 'request_changes' },
          comments: []
        }
      }
    })
}));

describe('PendingChangeAttribution', () => {
  it('shows reviewer and per-file request_changes', () => {
    render(<PendingChangeAttribution change={baseChange} />);
    expect(screen.getByText('Reviewer One')).toBeTruthy();
    expect(screen.getByText('changes')).toBeTruthy();
  });

  it('renders the decision badge with the chromeMeter surface chrome', () => {
    // Regression guard for the 2026-05 bug where
    // `pendingReviewDecisionBadgeClassName` passed `chromeMeterClassName`
    // to `cn()` as a function reference. clsx silently coerced it to "",
    // stripping the badge of `inline-flex h-6 items-center rounded-inner
    // bg-surface-overlay font-mono text-meta`. The visible symptom was a
    // text-only "changes" / "approved" label without the rounded chip
    // surface that the design system expects.
    render(<PendingChangeAttribution change={baseChange} />);
    const badge = screen.getByText('changes');
    const cls = badge.className;
    expect(cls).toContain('bg-surface-overlay');
    expect(cls).toContain('rounded-inner');
    expect(cls).toContain('font-mono');
    expect(cls).toContain('text-meta');
  });
});
