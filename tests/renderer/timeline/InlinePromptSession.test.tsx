/**
 * Inline prompt edit / revert session at the user message row.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// InlinePromptSession pulls the full composer shell (model picker, attachments).
// Stub those modules so this suite stays fast and does not contend with
// popover / IPC wiring unrelated to rewind preview + confirm.
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
    onDragOver: vi.fn(),
    onPaste: vi.fn()
  })
}));

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { InlinePromptSession } from '@renderer/components/timeline/revert/InlinePromptSession';
import { useCheckpointsStore } from '@renderer/store/useCheckpointsStore';
import { useToastStore } from '@renderer/store/useToastStore';
import { useChatStore } from '@renderer/store/useChatStore';
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

function renderSession(intent: { kind: 'revert' } | { kind: 'edit'; originalContent: string }) {
  return render(
    <InlinePromptSession
      conversationId={CONVERSATION}
      workspaceId={WORKSPACE}
      promptEventId={PROMPT_EVENT}
      intent={intent}
      model={{ providerId: 'p1', modelId: 'm1' }}
      onModelChange={() => undefined}
      onOpenProviders={() => undefined}
      onCancel={() => undefined}
    />
  );
}

beforeEach(() => {
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
  useChatStore.setState((prev) => ({
    ...prev,
    send: vi.fn(async () => undefined)
  }));
});

afterEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('InlinePromptSession', () => {
  it('shows compact impact summary for revert when preview is ready', async () => {
    installPreview(buildPreview({ transcriptEventsAffected: 6, runIds: ['r-1', 'r-2'] }));

    const { findByText } = renderSession({ kind: 'revert' });

    expect(await findByText(/6 events removed/i)).toBeInTheDocument();
    expect(await findByText(/rewrite the readme/i)).toBeInTheDocument();
    expect(await findByText(/2 runs/i)).toBeInTheDocument();
  });

  it('calls rewindToPrompt on revert confirm', async () => {
    installPreview(buildPreview({}));
    const rewindSpy = installRewind({
      ok: true,
      removedTranscriptEvents: 2,
      failedFiles: []
    });
    const onCancel = vi.fn();

    const { findByRole } = render(
      <InlinePromptSession
        conversationId={CONVERSATION}
        workspaceId={WORKSPACE}
        promptEventId={PROMPT_EVENT}
        intent={{ kind: 'revert' }}
        model={null}
        onModelChange={() => undefined}
        onOpenProviders={() => undefined}
        onCancel={onCancel}
      />
    );

    const revertBtn = await findByRole('button', { name: /^Revert$/i });
    await waitFor(() => expect(revertBtn).not.toBeDisabled());
    fireEvent.click(revertBtn);

    await waitFor(() => expect(rewindSpy).toHaveBeenCalledOnce());
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
  });

  it('rewinds then sends edited text on edit confirm', async () => {
    installPreview(buildPreview({}));
    installRewind({ ok: true, removedTranscriptEvents: 1, failedFiles: [] });
    const sendSpy = vi.fn(async () => undefined);
    useChatStore.setState((prev) => ({ ...prev, send: sendSpy }));

    const { findByRole } = renderSession({
      kind: 'edit',
      originalContent: 'hello'
    });

    const editor = await findByRole('textbox', { name: /Message Agent V/i });
    await waitFor(() => expect(editor).toHaveAttribute('contenteditable', 'true'));
    editor.textContent = 'hello again';
    fireEvent.input(editor);

    const sendBtn = await findByRole('button', { name: 'Send' });
    await waitFor(() => expect(sendBtn).not.toBeDisabled());
    fireEvent.click(sendBtn);

    await waitFor(() => expect(sendSpy).toHaveBeenCalledOnce());
    expect(sendSpy.mock.calls[0]?.[0]).toBe('hello again');
  });
});
