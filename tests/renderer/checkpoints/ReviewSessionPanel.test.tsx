/**
 * ReviewSessionPanel — PR-style review metadata (slice 1).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewSessionPanel } from '@renderer/components/checkpoints/review/ReviewSessionPanel.js';

const getReview = vi.fn();
const ensureReview = vi.fn();
const addReviewComment = vi.fn();
const setReviewDecision = vi.fn();
const setReviewGitBaseRef = vi.fn();
const gitBaseDiff = vi.fn();
const acceptPending = vi.fn();
const importReview = vi.fn();

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    checkpoints: {
      getReview: (...args: unknown[]) => getReview(...args),
      ensureReview: (...args: unknown[]) => ensureReview(...args),
      addReviewComment: (...args: unknown[]) => addReviewComment(...args),
      setReviewDecision: (...args: unknown[]) => setReviewDecision(...args),
      setReviewGitBaseRef: (...args: unknown[]) => setReviewGitBaseRef(...args),
      gitBaseDiff: (...args: unknown[]) => gitBaseDiff(...args),
      listGitRefs: vi.fn(async () => ({
        ok: true as const,
        options: [
          { ref: 'HEAD', group: 'builtin' as const },
          { ref: 'main', group: 'local' as const }
        ],
        head: 'main'
      })),
      setReviewReviewer: vi.fn(async () => baseSession),
      exportReview: vi.fn(async () => ({ exportPath: '/tmp/review.json', bytes: 10 }))
    }
  }
}));

const refreshReview = vi.fn(async () => {});

vi.mock('@renderer/store/useCheckpointsStore.js', () => ({
  reviewCacheKey: (ws: string, cid: string) => `${ws}:${cid}`,
  useCheckpointsStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        pendingByConversation: {
          'conv-1': [
            {
              entryId: 'e-1',
              conversationId: 'conv-1',
              filePath: 'src/foo.ts'
            }
          ]
        },
        reviewByConversation: {},
        accept: acceptPending,
        importReview,
        refreshReview
      }),
    {
      getState: () => ({
        refreshReview
      })
    }
  )
}));

vi.mock('@renderer/store/useSettingsStore.js', () => ({
  useSettingsStore: (selector: (s: { settings: { ui: Record<string, unknown> } }) => unknown) =>
    selector({
      settings: { ui: { approveAutoAcceptPendingByWorkspace: {} } }
    })
}));

vi.mock('@renderer/store/useToastStore.js', () => ({
  useToastStore: (selector: (s: { show: () => void }) => unknown) => selector({ show: vi.fn() })
}));

const baseSession = {
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  runId: 'run-1',
  startedAt: 1,
  updatedAt: 1,
  comments: [] as { id: string; filePath: string; body: string; createdAt: number }[]
};

beforeEach(() => {
  getReview.mockReset();
  ensureReview.mockReset();
  addReviewComment.mockReset();
  setReviewDecision.mockReset();
  setReviewGitBaseRef.mockReset();
  gitBaseDiff.mockReset();
  acceptPending.mockReset();
  importReview.mockReset();
  refreshReview.mockReset();

  getReview.mockResolvedValue(null);
  ensureReview.mockResolvedValue(baseSession);
  addReviewComment.mockResolvedValue(undefined);
  setReviewGitBaseRef.mockResolvedValue({ ...baseSession, gitBaseRef: 'main' });
  setReviewDecision.mockResolvedValue({
    ...baseSession,
    fileDecisions: { 'src/foo.ts': 'approve' as const }
  });
  gitBaseDiff.mockResolvedValue({ ok: false, reason: 'not-a-repo' as const });
  acceptPending.mockResolvedValue(true);
});

describe('ReviewSessionPanel', () => {
  it('explains post-hoc metadata and loads session', async () => {
    render(
      <ReviewSessionPanel
        workspaceId="ws-1"
        conversationId="conv-1"
        runId="run-1"
        filePath="src/foo.ts"
      />
    );

    await waitFor(() => {
      expect(ensureReview).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        runId: 'run-1'
      });
    });

    expect(
      screen.getByText(/does not merge to git or auto-accept pending/i)
    ).toBeTruthy();
  });

  it('adds a file comment via IPC', async () => {
    const user = userEvent.setup();
    render(
      <ReviewSessionPanel
        workspaceId="ws-1"
        conversationId="conv-1"
        filePath="src/foo.ts"
      />
    );

    await waitFor(() => expect(ensureReview).toHaveBeenCalled());

    const input = screen.getByPlaceholderText(/Add a review comment/i);
    await user.type(input, 'Looks good');
    await user.click(screen.getByRole('button', { name: /^Comment$/i }));

    await waitFor(() => {
      expect(addReviewComment).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        filePath: 'src/foo.ts',
        body: 'Looks good'
      });
    });
  });

  it('imports review via store and refreshes session', async () => {
    const user = userEvent.setup();
    importReview.mockResolvedValue({
      session: {
        ...baseSession,
        reviewerLabel: 'Imported',
        decision: 'approve' as const
      },
      applied: 'replace' as const
    });

    render(
      <ReviewSessionPanel
        workspaceId="ws-1"
        conversationId="conv-1"
        filePath="src/foo.ts"
      />
    );

    await waitFor(() => expect(ensureReview).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /^Import review$/i }));

    await waitFor(() => {
      expect(importReview).toHaveBeenCalledWith('ws-1', 'conv-1', undefined, {
        restorePending: false
      });
    });
  });

  it('passes restorePending when import checkbox is checked', async () => {
    const user = userEvent.setup();
    importReview.mockResolvedValue({
      session: baseSession,
      applied: 'replace' as const,
      pendingRestore: { restored: 2, skipped: 0 }
    });

    render(
      <ReviewSessionPanel
        workspaceId="ws-1"
        conversationId="conv-1"
        filePath="src/foo.ts"
      />
    );

    await waitFor(() => expect(ensureReview).toHaveBeenCalled());

    await user.click(screen.getByLabelText(/Restore pending from export/i));
    await user.click(screen.getByRole('button', { name: /^Import review$/i }));

    await waitFor(() => {
      expect(importReview).toHaveBeenCalledWith('ws-1', 'conv-1', undefined, {
        restorePending: true
      });
    });
  });

  it('anchors comments from git-base diff line clicks', async () => {
    const user = userEvent.setup();
    const onCommentLineChange = vi.fn();
    gitBaseDiff.mockResolvedValue({
      ok: true as const,
      patch: '@@ -1 +1 @@\n line\n+added\n',
      ref: 'HEAD'
    });

    render(
      <ReviewSessionPanel
        workspaceId="ws-1"
        conversationId="conv-1"
        filePath="src/foo.ts"
        commentLine={null}
        onCommentLineChange={onCommentLineChange}
      />
    );

    await waitFor(() => expect(ensureReview).toHaveBeenCalled());

    await user.click(screen.getByLabelText(/Compare to git base/i));

    await waitFor(() => {
      expect(gitBaseDiff).toHaveBeenCalled();
    });

    const addedRow = await screen.findByRole('button', { name: /added/i });
    await user.click(addedRow);

    expect(onCommentLineChange).toHaveBeenCalledWith(2);
  });

  it('sets approve decision without accepting pending edits', async () => {
    const user = userEvent.setup();
    render(
      <ReviewSessionPanel
        workspaceId="ws-1"
        conversationId="conv-1"
        filePath="src/foo.ts"
      />
    );

    await waitFor(() => expect(ensureReview).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: /^Approve$/i }));

    await waitFor(() => {
      expect(setReviewDecision).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        decision: 'approve',
        filePath: 'src/foo.ts'
      });
    });
  });
});
