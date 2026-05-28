/**
 * ReviewDiffViewer — read-only checkpoint diff + optional git base compare.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewDiffViewer } from '@renderer/components/checkpoints/review/ReviewDiffViewer';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import type { PendingChange } from '@shared/types/checkpoint';

const change: PendingChange = {
  entryId: 'e-1',
  runId: 'run-1',
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  filePath: 'src/foo.ts',
  kind: 'modify',
  preHash: 'pre',
  postHash: 'post',
  additions: 2,
  deletions: 1,
  createdAt: 1,
  source: 'edit'
};

beforeEach(() => {
  useWorkspaceStore.setState({ activeId: 'ws-1' });
  vi.spyOn(window.vyotiq.checkpoints, 'listGitRefs').mockResolvedValue({
    ok: true,
    options: [{ ref: 'HEAD', group: 'builtin' }],
    head: 'main'
  });
  vi.spyOn(window.vyotiq.checkpoints, 'gitBaseDiff').mockResolvedValue({
    ok: true,
    ref: 'HEAD',
    patch: '@@ -1 +1 @@\n-old\n+new'
  });
});

describe('ReviewDiffViewer', () => {
  it('renders path, stats, and read-only notice', () => {
    render(<ReviewDiffViewer change={change} />);
    expect(screen.getByTitle('src/foo.ts')).toBeInTheDocument();
    expect(screen.getByText(/read-only review/i)).toBeInTheDocument();
  });

  it('loads git diff when compare-to-base is enabled', async () => {
    render(<ReviewDiffViewer change={change} />);
    await userEvent.click(screen.getByLabelText(/compare to git base/i));
    await waitFor(() =>
      expect(window.vyotiq.checkpoints.gitBaseDiff).toHaveBeenCalledWith(
        'ws-1',
        'src/foo.ts',
        'HEAD'
      )
    );
  });
});
