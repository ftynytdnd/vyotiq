/**
 * `RevertPromptContext` / `RevertPromptProvider` contract.
 *
 * Pins three behaviours:
 *   1. `requestRevert` no-ops when chat / workspace stores have no
 *      active ids (no inline session opens).
 *   2. `requestRevert` opens an inline session with the resolved triple
 *      `(conversationId, workspaceId, promptEventId)` so preview can fire.
 *   3. `closeSession` clears `isSessionOpen`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/components/composer/modelPicker/index.js', () => ({
  ModelPicker: () => null
}));
vi.mock('@renderer/components/composer/useComposerAttachments.js', () => ({
  useComposerAttachments: () => ({
    attachments: [],
    setAttachments: vi.fn(),
    addPaths: vi.fn(async () => undefined),
    pickFromComputer: vi.fn(async () => undefined),
    remove: vi.fn(),
    peekPendingMessageId: () => 'msg-stub',
    onDrop: vi.fn(),
    onDragOver: vi.fn()
  })
}));

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import {
  RevertPromptProvider,
  useRevertPrompt
} from '@renderer/components/timeline/revert/RevertPromptContext';
import { InlinePromptSession } from '@renderer/components/timeline/revert/InlinePromptSession';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';

const PROMPT = 'evt-1';

function installBenignPreview() {
  const spy = vi.fn(async () => ({
    ok: false as const,
    error: { kind: 'no-run-binding' as const, promptEventId: PROMPT }
  }));
  useCheckpointsStore.setState((prev) => ({ ...prev, previewRewind: spy }));
  return spy;
}

function Consumer() {
  const ctx = useRevertPrompt();
  if (!ctx) return <span data-testid="ctx-missing">no ctx</span>;
  const session = ctx.activeSession;
  return (
    <div>
      <button onClick={() => ctx.requestRevert({ promptEventId: PROMPT })}>
        request-revert
      </button>
      <button type="button" onClick={ctx.closeSession}>
        close-session
      </button>
      <span data-testid="open">{ctx.isSessionOpen ? 'yes' : 'no'}</span>
      {session && (
        <InlinePromptSession
          conversationId={session.conversationId}
          workspaceId={session.workspaceId}
          promptEventId={session.promptEventId}
          intent={session.intent}
          model={ctx.model}
          onModelChange={ctx.onModelChange}
          onOpenProviders={ctx.onOpenProviders}
          onCancel={ctx.closeSession}
        />
      )}
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
      <RevertPromptProvider onModelChange={() => {}} onOpenProviders={() => {}}>
        <Consumer />
      </RevertPromptProvider>
    );

    act(() => {
      fireEvent.click(getByText('request-revert'));
    });

    expect(getByTestId('open').textContent).toBe('no');
    expect(queryByRole('form')).toBeNull();
  });

  it('opens inline revert with the resolved triple when ids are present', async () => {
    useChatStore.setState({ conversationId: 'c-1' });
    useWorkspaceStore.setState({ activeId: 'ws-1' });

    const { getByText, getByTestId } = render(
      <RevertPromptProvider onModelChange={() => {}} onOpenProviders={() => {}}>
        <Consumer />
      </RevertPromptProvider>
    );

    act(() => {
      fireEvent.click(getByText('request-revert'));
    });

    expect(getByTestId('open').textContent).toBe('yes');
    expect(getByText(/Revert to here/i)).toBeTruthy();

    await waitFor(() => {
      expect(useCheckpointsStore.getState().previewRewind).toHaveBeenCalledWith({
        conversationId: 'c-1',
        workspaceId: 'ws-1',
        promptEventId: PROMPT
      });
    });
  });

  it('clears isSessionOpen when the session is closed', async () => {
    useChatStore.setState({ conversationId: 'c-1' });
    useWorkspaceStore.setState({ activeId: 'ws-1' });

    const { getByText, getByTestId } = render(
      <RevertPromptProvider onModelChange={() => {}} onOpenProviders={() => {}}>
        <Consumer />
      </RevertPromptProvider>
    );

    act(() => {
      fireEvent.click(getByText('request-revert'));
    });

    expect(getByTestId('open').textContent).toBe('yes');

    act(() => {
      fireEvent.click(getByText('close-session'));
    });

    expect(getByTestId('open').textContent).toBe('no');
  });
});
