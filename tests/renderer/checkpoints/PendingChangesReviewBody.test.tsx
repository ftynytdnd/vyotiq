/**

 * PendingChangesReviewBody — review drawer body behavior.

 */



import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen, waitFor } from '@testing-library/react';

import userEvent from '@testing-library/user-event';

import type { PendingChange } from '@shared/types/checkpoint.js';

import { PendingChangesReviewBody } from '@renderer/components/checkpoints/pending/PendingChangesReviewBody.js';



const accept = vi.fn(async () => true);

const reject = vi.fn(async () => ({ ok: true as const }));



const readBlob = vi.fn(async () => 'line one\nline two\n');



const refreshReview = vi.fn(async () => {});



vi.mock('@renderer/store/useCheckpointsStore.js', () => ({

  reviewCacheKey: (ws: string, cid: string) => `${ws}:${cid}`,

  useCheckpointsStore: Object.assign(

    (

      selector: (s: {

        accept: typeof accept;

        reject: typeof reject;

        readBlob: typeof readBlob;

        pendingByConversation: Record<string, PendingChange[]>;

        reviewByConversation: Record<string, unknown>;

        refreshReview: typeof refreshReview;

        importReview: () => Promise<null>;

      }) => unknown

    ) =>

      selector({

        accept,

        reject,

        readBlob,

        pendingByConversation: { 'conv-1': [] },

        reviewByConversation: {},

        refreshReview,

        importReview: vi.fn(async () => null)

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

    selector({ settings: { ui: {} } })

}));



vi.mock('@renderer/store/useToastStore.js', () => ({

  useToastStore: (selector: (s: { show: () => void }) => unknown) => selector({ show: vi.fn() })

}));



vi.mock('@renderer/lib/ipc.js', () => ({

  vyotiq: {

    checkpoints: {

      getReview: vi.fn(async () => null),

      ensureReview: vi.fn(async () => ({

        conversationId: 'conv-1',

        workspaceId: 'ws-1',

        startedAt: 1,

        updatedAt: 1,

        comments: []

      })),

      addReviewComment: vi.fn(),

      setReviewDecision: vi.fn(),

      setReviewGitBaseRef: vi.fn(async () => ({

        conversationId: 'conv-1',

        workspaceId: 'ws-1',

        startedAt: 1,

        updatedAt: 1,

        comments: []

      })),

      gitBaseDiff: vi.fn(async () => ({ ok: false, reason: 'not-a-repo' as const })),

      listGitRefs: vi.fn(async () => ({

        ok: true as const,

        options: [{ ref: 'HEAD', group: 'builtin' as const }],

        head: 'main'

      })),

      setReviewReviewer: vi.fn(),

      exportReview: vi.fn()

    }

  }

}));



const entry: PendingChange = {

  entryId: 'e-1',

  runId: 'run-1',

  conversationId: 'conv-1',

  workspaceId: 'ws-1',

  filePath: 'src/foo.ts',

  kind: 'modify',

  preHash: 'pre',

  postHash: 'post',

  additions: 1,

  deletions: 0,

  createdAt: 1,

  source: 'edit'

};



beforeEach(() => {

  accept.mockClear();

  reject.mockClear();

  refreshReview.mockClear();

});



describe('PendingChangesReviewBody', () => {

  it('shows file progress when entries are present', () => {

    render(<PendingChangesReviewBody entries={[entry]} />);

    expect(screen.getByText(/file 1 of 1/i)).toBeTruthy();

  });



  it('calls onFinished when entries become empty', async () => {

    const onFinished = vi.fn();

    const { rerender } = render(

      <PendingChangesReviewBody entries={[entry]} onFinished={onFinished} />

    );

    rerender(<PendingChangesReviewBody entries={[]} onFinished={onFinished} />);

    await waitFor(() => expect(onFinished).toHaveBeenCalled());

  });



  it('accept keyboard shortcut invokes accept', async () => {

    render(<PendingChangesReviewBody entries={[entry]} />);

    await userEvent.keyboard('a');

    expect(accept).toHaveBeenCalledWith('e-1', 'conv-1');

  });

});


