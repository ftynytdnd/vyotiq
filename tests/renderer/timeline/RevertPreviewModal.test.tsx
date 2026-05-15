/**
 * `RevertPreviewModal` rendering + confirm flow contract.
 *
 * The modal is the inline rewind UX surfaced from the per-prompt
 * Revert button. We pin five behaviours here:
 *
 *   1. Loading phase: the "Computing impact…" placeholder is visible
 *      while `previewRewind` is in flight.
 *   2. Ready phase with files: prompt preview, file rows, totals
 *      (`+N -M`), transcript-event count, and run-rollback count
 *      all render.
 *   3. `alreadyReverted`-only preview: the explicit muted line
 *      acknowledging the no-op file revert is rendered.
 *   4. Confirm happy path: `rewindToPrompt` is invoked, the modal
 *      calls `onClose`, and a success toast is queued.
 *   5. Failed-files path: modal stays open in its `error` phase
 *      and surfaces the danger toast.
 *
 * Store actions (`previewRewind`, `rewindToPrompt`) are swapped via
 * `useCheckpointsStore.setState` exactly the way
 * `pendingChangeCreateDiff.test.tsx` already swaps `readBlob`. Toast
 * dispatches go through the real `useToastStore` which we read back
 * after the test to assert the surfaced message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { RevertPreviewModal } from '@renderer/components/timeline/revert/RevertPreviewModal';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';
import { useToastStore } from '@renderer/store/useToastStore';
import type {
  RewindFileChange,
  RewindPreview,
  RewindPreviewResult,
  RewindResult
} from '@shared/types/checkpoint';

const WORKSPACE = 'ws-test';
const CONVERSATION = 'c-test';
const PROMPT_EVENT = 'evt-prompt-1';

function fileChange(overrides: Partial<RewindFileChange>): RewindFileChange {
  return {
    filePath: 'src/foo.ts',
    kind: 'modify',
    workspaceId: WORKSPACE,
    runId: 'r-1',
    entryId: 'e-1',
    additions: 3,
    deletions: 1,
    alreadyReverted: false,
    ...overrides
  };
}

function buildPreview(overrides: Partial<RewindPreview>): RewindPreview {
  return {
    ok: true,
    conversationId: CONVERSATION,
    workspaceId: WORKSPACE,
    promptEventId: PROMPT_EVENT,
    promptContent: 'rewrite the readme',
    promptTs: 1,
    runIds: ['r-1'],
    files: [fileChange({})],
    transcriptEventsAffected: 4,
    ...overrides
  };
}

function installPreview(result: RewindPreviewResult) {
  const spy = vi.fn(async () => result);
  useCheckpointsStore.setState((prev) => ({ ...prev, previewRewind: spy }));
  return spy;
}

function installRewind(result: RewindResult) {
  const spy = vi.fn(async () => result);
  useCheckpointsStore.setState((prev) => ({ ...prev, rewindToPrompt: spy }));
  return spy;
}

beforeEach(() => {
  // Reset both spy slots so a test that doesn't install a stub gets
  // a deterministic resolved-promise default rather than the previous
  // test's leftover fixture.
  useCheckpointsStore.setState((prev) => ({
    ...prev,
    previewRewind: vi.fn(async () => ({
      ok: false as const,
      error: { kind: 'unknown-prompt' as const, promptEventId: PROMPT_EVENT }
    })),
    rewindToPrompt: vi.fn(async () => ({
      ok: false as const,
      error: { kind: 'unknown-prompt' as const, promptEventId: PROMPT_EVENT }
    }))
  }));
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  // Belt-and-braces — `cleanup` already unmounts; clear toasts so
  // the next file's first test starts with an empty queue.
  useToastStore.setState({ toasts: [] });
});

describe('RevertPreviewModal phases', () => {
  it('renders the loading placeholder while previewRewind is in flight', async () => {
    // Resolve only after we have a chance to read the loading text.
    let resolvePreview: (v: RewindPreview) => void = () => { };
    useCheckpointsStore.setState((prev) => ({
      ...prev,
      previewRewind: vi.fn(
        () => new Promise<RewindPreview>((res) => {
          resolvePreview = res;
        })
      )
    }));

    const { findByText } = render(
      <RevertPreviewModal
        open={true}
        conversationId={CONVERSATION}
        workspaceId={WORKSPACE}
        promptEventId={PROMPT_EVENT}
        onClose={() => undefined}
      />
    );

    expect(await findByText(/Computing impact/i)).toBeInTheDocument();
    // Resolve the pending preview promise inside `act` so the React
    // state flush from the post-resolve `setPhase('ready')` doesn't
    // trigger the act-warning at test teardown.
    await act(async () => {
      resolvePreview(buildPreview({}));
      await Promise.resolve();
    });
  });

  it('renders prompt preview, totals, run count, and file rows when ready', async () => {
    installPreview(
      buildPreview({
        files: [
          fileChange({ filePath: 'src/a.ts', additions: 2, deletions: 0 }),
          fileChange({
            entryId: 'e-2',
            filePath: 'src/b.ts',
            kind: 'create',
            additions: 5,
            deletions: 0
          })
        ],
        runIds: ['r-1', 'r-2'],
        transcriptEventsAffected: 6,
        promptContent: 'rewrite the readme'
      })
    );

    const { findByRole } = render(
      <RevertPreviewModal
        open={true}
        conversationId={CONVERSATION}
        workspaceId={WORKSPACE}
        promptEventId={PROMPT_EVENT}
        onClose={() => undefined}
      />
    );

    const dialog = await findByRole('dialog');
    await waitFor(() => {
      expect(dialog.textContent ?? '').toContain('rewrite the readme');
    });
    expect(dialog.textContent ?? '').toMatch(/2 files/i);
    expect(dialog.textContent ?? '').toMatch(/\+7 −0/);
    expect(dialog.textContent ?? '').toMatch(/2 runs/i);
    expect(dialog.textContent ?? '').toMatch(/6 transcript events/i);
    // Per-file rows render their full path in a `title` attribute on
    // the row container (the visible text is split into dir + filename
    // spans so a plain `getByText('src/b.ts')` cannot match a single
    // text node).
    expect(dialog.querySelector('[title="src/a.ts"]')).not.toBeNull();
    expect(dialog.querySelector('[title="src/b.ts"]')).not.toBeNull();
  });

  it('surfaces an "already reverted manually" line when every file is alreadyReverted', async () => {
    installPreview(
      buildPreview({
        files: [
          fileChange({ entryId: 'e-1', alreadyReverted: true }),
          fileChange({ entryId: 'e-2', filePath: 'src/b.ts', alreadyReverted: true })
        ]
      })
    );

    const { findByRole } = render(
      <RevertPreviewModal
        open={true}
        conversationId={CONVERSATION}
        workspaceId={WORKSPACE}
        promptEventId={PROMPT_EVENT}
        onClose={() => undefined}
      />
    );

    const dialog = await findByRole('dialog');
    await waitFor(() => {
      expect(dialog.textContent ?? '').toMatch(/already reverted manually/i);
    });
  });

  it('fires rewindToPrompt and closes on confirm (success path)', async () => {
    installPreview(buildPreview({}));
    const rewindSpy = installRewind({
      ok: true,
      conversationId: CONVERSATION,
      workspaceId: WORKSPACE,
      promptEventId: PROMPT_EVENT,
      revertedRunIds: ['r-1'],
      revertedFiles: [fileChange({})],
      failedFiles: [],
      removedTranscriptEvents: 4,
      deletedRunManifests: 1,
      droppedPending: 0
    });

    const onClose = vi.fn();
    const { findByRole } = render(
      <RevertPreviewModal
        open={true}
        conversationId={CONVERSATION}
        workspaceId={WORKSPACE}
        promptEventId={PROMPT_EVENT}
        onClose={onClose}
      />
    );

    const dialog = await findByRole('dialog');
    // Wait for the ready phase by polling for the Revert button to
    // enable (it stays disabled in loading / error phases).
    const revert = await waitFor(() => {
      const candidates = dialog.querySelectorAll('button');
      const found = Array.from(candidates).find(
        (b) => b.textContent?.trim() === 'Revert'
      );
      if (!found || found.hasAttribute('disabled')) {
        throw new Error('Revert button not yet enabled');
      }
      return found;
    });
    fireEvent.click(revert);

    await waitFor(() => {
      expect(rewindSpy).toHaveBeenCalledWith({
        conversationId: CONVERSATION,
        workspaceId: WORKSPACE,
        promptEventId: PROMPT_EVENT
      });
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    // Success toast surfaced.
    const toasts = useToastStore.getState().toasts;
    expect(toasts.length).toBeGreaterThan(0);
    expect(toasts[toasts.length - 1]?.tone).toBe('success');
  });

  it('keeps the modal open on partial failure and surfaces a danger toast', async () => {
    installPreview(buildPreview({}));
    installRewind({
      ok: false,
      error: { kind: 'blob-missing', hash: 'sha256:deadbeefcafe' }
    });

    const onClose = vi.fn();
    const { findByRole } = render(
      <RevertPreviewModal
        open={true}
        conversationId={CONVERSATION}
        workspaceId={WORKSPACE}
        promptEventId={PROMPT_EVENT}
        onClose={onClose}
      />
    );

    const dialog = await findByRole('dialog');
    const revert = await waitFor(() => {
      const candidates = dialog.querySelectorAll('button');
      const found = Array.from(candidates).find(
        (b) => b.textContent?.trim() === 'Revert'
      );
      if (!found || found.hasAttribute('disabled')) {
        throw new Error('Revert button not yet enabled');
      }
      return found;
    });
    fireEvent.click(revert);

    // Modal lands in error phase — onClose must NOT have fired.
    await waitFor(() => {
      expect(dialog.textContent ?? '').toMatch(/Could not compute revert preview/i);
    });
    expect(onClose).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    const last = toasts[toasts.length - 1];
    expect(last?.tone).toBe('danger');
    expect(last?.message ?? '').toMatch(/Revert failed/i);
  });

  it('cancel button does not invoke rewindToPrompt', async () => {
    installPreview(buildPreview({}));
    const rewindSpy = installRewind({
      ok: false,
      error: { kind: 'unknown-prompt', promptEventId: PROMPT_EVENT }
    });

    const onClose = vi.fn();
    const { findByRole } = render(
      <RevertPreviewModal
        open={true}
        conversationId={CONVERSATION}
        workspaceId={WORKSPACE}
        promptEventId={PROMPT_EVENT}
        onClose={onClose}
      />
    );

    const dialog = await findByRole('dialog');
    const cancel = await waitFor(() => {
      const found = Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Cancel'
      );
      if (!found) throw new Error('Cancel button missing');
      return found;
    });
    fireEvent.click(cancel);

    expect(onClose).toHaveBeenCalled();
    expect(rewindSpy).not.toHaveBeenCalled();
  });
});
