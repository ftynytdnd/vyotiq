/**
 * PendingChangeDiff modify-kind minimap contract.
 *
 * Checkpoint diffs reuse `EditDiffView` → `DiffViewer`, which mounts
 * `DiffMinimap` when there are 2+ hunks. This test pins that wiring
 * for the pending-changes panel (T5.9 parity with timeline edits).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { PendingChangeDiff } from '@renderer/components/checkpoints/PendingChangeDiff';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';

const WORKSPACE = 'ws-test';
const PRE_HASH = 'sha256:pre';
const POST_HASH = 'sha256:post';

function installFakeReadBlob(pre: string | null, post: string | null) {
  useCheckpointsStore.setState((prev) => ({
    ...prev,
    readBlob: async (_workspaceId: string, hash: string) => {
      if (hash === PRE_HASH) return pre;
      if (hash === POST_HASH) return post;
      return null;
    }
  }));
}

beforeEach(() => {
  installFakeReadBlob(null, null);
});

describe('PendingChangeDiff — modify minimap', () => {
  it('renders the diff hunk minimap when multiple hunks are present', async () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const lines = before.split('\n');
    lines[5] = 'CHANGE_5';
    lines[15] = 'CHANGE_15';
    const after = lines.join('\n');
    installFakeReadBlob(before, after);

    const { getByLabelText } = render(
      <PendingChangeDiff
        workspaceId={WORKSPACE}
        kind="modify"
        preHash={PRE_HASH}
        postHash={POST_HASH}
      />
    );

    await waitFor(() => {
      expect(getByLabelText('Diff hunk minimap')).toBeTruthy();
    });
  });
});
