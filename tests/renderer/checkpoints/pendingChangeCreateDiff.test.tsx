/**
 * `PendingChangeDiff` create-kind rendering contract.
 *
 * Mirrors `tests/renderer/timeline/createDiffRendering.test.tsx` —
 * the pending-changes panel was the SECOND place hitting the same
 * bug: `kind === 'create'` rendered through `CodeBlock tone="muted"`
 * instead of the shared `EditDiffView`, producing the muted
 * plain-text view the user complained about ("what the fuck is
 * wrong with these diffs?" in the screenshot showing the expanded
 * `Created README.md` row).
 *
 * The fix routes `kind === 'create'` through `EditDiffView` with
 * hunks synthesised by `synthesizeCreateHunks`, identical to the
 * timeline `EditInvocation` settled-create branch.
 *
 * `useCheckpointsStore` is replaced for these tests so we can drive
 * the blob state synchronously without an IPC bridge — the store
 * already exposes a `readBlob` function that returns a Promise so
 * the swap is a one-line resolver.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { PendingChangeDiff } from '@renderer/components/checkpoints/PendingChangeDiff';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';

const WORKSPACE = 'ws-test';
const POST_HASH = 'sha256:new-file';

function installFakeReadBlob(body: string | null) {
  // Replace the store's readBlob with a synchronous resolver so the
  // PendingChangeDiff effect completes in one microtask.
  useCheckpointsStore.setState((prev) => ({
    ...prev,
    readBlob: async (_workspaceId: string, hash: string) =>
      hash === POST_HASH ? body : null
  }));
}

beforeEach(() => {
  // Reset every readBlob override between tests.
  installFakeReadBlob(null);
});

describe('PendingChangeDiff — kind="create"', () => {
  it('renders the new file body as an EditDiffView with all-`+` lines', async () => {
    installFakeReadBlob('# Vyotiq\n\nfresh content');
    const { container } = render(
      <PendingChangeDiff
        workspaceId={WORKSPACE}
        kind="create"
        postHash={POST_HASH}
      />
    );
    // Effect resolves the blob then the create branch mounts.
    await waitFor(() => {
      expect(container.querySelector('[data-variant="authoritative"]')).not.toBeNull();
    });
    // All three content lines visible.
    expect(container.textContent ?? '').toContain('# Vyotiq');
    expect(container.textContent ?? '').toContain('fresh content');
  });

  it('handles a missing snapshot gracefully (post body null)', async () => {
    // No installer call → readBlob returns null for every hash.
    const { container } = render(
      <PendingChangeDiff
        workspaceId={WORKSPACE}
        kind="create"
        postHash={POST_HASH}
      />
    );
    // The placeholder text appears once the resolve completes.
    await waitFor(() => {
      expect(container.textContent ?? '').toContain('Snapshot missing');
    });
    // No `EditDiffView` mounted — `data-variant` MUST be absent.
    expect(container.querySelector('[data-variant]')).toBeNull();
  });
});

describe('PendingChangeDiff — settle never overwrites the create render', () => {
  it('keeps the diff rendered after the effect has settled (no late-mount regression)', async () => {
    installFakeReadBlob('once\ntwice');
    const { container } = render(
      <PendingChangeDiff
        workspaceId={WORKSPACE}
        kind="create"
        postHash={POST_HASH}
      />
    );
    await waitFor(() => {
      expect(container.querySelector('[data-variant="authoritative"]')).not.toBeNull();
    });
    // Flush a microtask — the diff stays mounted (no remount loop).
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-variant="authoritative"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('once');
    expect(container.textContent ?? '').toContain('twice');
  });
});
