/**
 * `RevertPromptContext` / `RevertPromptProvider` contract.
 *
 * Pins three behaviours:
 *   1. `requestRevert` no-ops when chat / workspace stores have no
 *      active ids (the modal never opens).
 *   2. `requestRevert` opens the modal with the resolved triple
 *      `(conversationId, workspaceId, promptEventId)` so the preview
 *      effect can fire `previewRewind`.
 *   3. The `isModalOpen` flag flips back to `false` after Cancel,
 *      proving the cleanup path is wired.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import {
  RevertPromptProvider,
  useRevertPrompt
} from '@renderer/components/timeline/revert/RevertPromptContext';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';

const PROMPT = 'evt-1';

/** Stub previewRewind so the modal that opens after `requestRevert`
 *  doesn't try to drive a real IPC bridge. The benign error puts the
 *  modal into its `error` phase, which is still observable as an
 *  open `role="dialog"`. */
function installBenignPreview() {
  const spy = vi.fn(async () => ({
    ok: false as const,
    error: { kind: 'no-run-binding' as const, promptEventId: PROMPT }
  }));
  useCheckpointsStore.setState((prev) => ({ ...prev, previewRewind: spy }));
  return spy;
}

/**
 * Tiny consumer that exposes the context value to the test surface.
 * Renders a button that calls `requestRevert` with a stable id, and
 * a span that mirrors `isModalOpen` so the assertion doesn't have to
 * dig through portal-rendered DOM for the cleanup test.
 */
function Consumer() {
  const ctx = useRevertPrompt();
  if (!ctx) return <span data-testid="ctx-missing">no ctx</span>;
  return (
    <div>
      <button onClick={() => ctx.requestRevert({ promptEventId: PROMPT })}>
        request-revert
      </button>
      <span data-testid="open">{ctx.isModalOpen ? 'yes' : 'no'}</span>
    </div>
  );
}

beforeEach(() => {
  useChatStore.setState({ conversationId: null, isProcessing: false });
  useWorkspaceStore.setState({ activeId: null });
  installBenignPreview();
});

describe('RevertPromptProvider', () => {
  it('no-ops requestRevert when there is no active conversation or workspace', () => {
    const { getByText, getByTestId, queryByRole } = render(
      <RevertPromptProvider>
        <Consumer />
      </RevertPromptProvider>
    );

    act(() => {
      fireEvent.click(getByText('request-revert'));
    });

    expect(getByTestId('open').textContent).toBe('no');
    expect(queryByRole('dialog')).toBeNull();
  });

  it('opens the modal with the resolved triple when ids are present', async () => {
    useChatStore.setState({ conversationId: 'c-1' });
    useWorkspaceStore.setState({ activeId: 'ws-1' });

    const { getByText, getByTestId, findByRole } = render(
      <RevertPromptProvider>
        <Consumer />
      </RevertPromptProvider>
    );

    act(() => {
      fireEvent.click(getByText('request-revert'));
    });

    expect(getByTestId('open').textContent).toBe('yes');
    const dialog = await findByRole('dialog');
    expect(dialog.textContent ?? '').toMatch(/Revert to before this message/i);

    // The modal triggered the stubbed previewRewind with the resolved
    // triple — proving the provider passed conversation + workspace
    // through.
    await waitFor(() => {
      expect(useCheckpointsStore.getState().previewRewind).toHaveBeenCalledWith({
        conversationId: 'c-1',
        workspaceId: 'ws-1',
        promptEventId: PROMPT
      });
    });
  });

  it('clears isModalOpen when Cancel is pressed', async () => {
    useChatStore.setState({ conversationId: 'c-1' });
    useWorkspaceStore.setState({ activeId: 'ws-1' });

    const { getByText, getByTestId, findByRole } = render(
      <RevertPromptProvider>
        <Consumer />
      </RevertPromptProvider>
    );

    act(() => {
      fireEvent.click(getByText('request-revert'));
    });

    const dialog = await findByRole('dialog');
    const cancel = await waitFor(() => {
      const found = Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Cancel'
      );
      if (!found) throw new Error('Cancel button missing');
      return found;
    });

    act(() => {
      fireEvent.click(cancel);
    });

    expect(getByTestId('open').textContent).toBe('no');
  });
});
