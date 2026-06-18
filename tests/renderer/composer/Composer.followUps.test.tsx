/**
 * Composer follow-up routing — steering vs queue during active runs.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '@renderer/components/composer/Composer';
import { useChatStore } from '@renderer/store/useChatStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';
import { emptySlice } from '@renderer/store/chatStoreTypes';
import { mirrorOf } from '@renderer/store/chatStoreMirror';
import type { FollowUpMessage } from '@shared/types/followUp.js';

const setAttachmentsMock = vi.hoisted(() => vi.fn());

vi.mock('@renderer/components/composer/useComposerAttachments.js', () => ({
  useComposerAttachments: () => ({
    attachments: [],
    setAttachments: setAttachmentsMock,
    pickFromComputer: vi.fn(),
    remove: vi.fn(),
    clearAttachments: vi.fn(),
    peekPendingMessageId: vi.fn(() => 'msg-1'),
    onDrop: vi.fn(),
    onDragOver: vi.fn(),
    onPaste: vi.fn()
  })
}));

vi.mock('@renderer/components/composer/useComposerHistory.js', () => ({
  useComposerHistory: () => ({
    recall: () => null,
    reset: vi.fn()
  })
}));

vi.mock('@renderer/components/composer/useComposerTokenEstimate.js', () => ({
  useComposerTokenEstimate: () => null
}));

const enqueueFollowUpMock = vi.fn(async () => undefined);
const updateFollowUpMock = vi.fn(async () => undefined);
const sendMock = vi.fn(async () => undefined);

function queuedItem(overrides: Partial<FollowUpMessage> = {}): FollowUpMessage {
  return {
    id: 'q-1',
    kind: 'queue',
    prompt: 'Queued task',
    selection: { providerId: 'p1', modelId: 'm1' },
    queuedAt: 1,
    source: 'composer',
    ...overrides
  };
}

function seedProcessingComposer(draft = 'Follow up now') {
  useChatStore.setState((state) => {
    const slice = {
      ...(state.slices.c1 ?? emptySlice('c1')),
      isProcessing: true,
      draft,
      followUps: { steering: [], queued: [] }
    };
    return {
      ...state,
      conversationId: 'c1',
      slices: { ...state.slices, c1: slice },
      ...mirrorOf(slice),
      enqueueFollowUp: enqueueFollowUpMock,
      updateFollowUp: updateFollowUpMock,
      removeFollowUp: vi.fn(),
      sendFollowUpNow: vi.fn(),
      send: sendMock
    };
  });
}

beforeEach(() => {
  enqueueFollowUpMock.mockClear();
  updateFollowUpMock.mockClear();
  sendMock.mockClear();
  setAttachmentsMock.mockClear();
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: 'c1',
    isProcessing: false,
    send: sendMock,
    abort: vi.fn(),
    setDraft: vi.fn(),
    draft: ''
  });
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    list: [{ id: 'ws-1', label: 'Demo', path: '/tmp/demo' }],
    loading: false
  } as never);
  useSettingsStore.setState({ settings: {} } as never);
  useProviderStore.setState({
    providers: [
      {
        id: 'p1',
        name: 'Local',
        enabled: true,
        models: [{ id: 'm1', name: 'Model', contextWindow: 8192 }]
      }
    ]
  } as never);
});

describe('Composer follow-ups', () => {
  it('enqueues steering when Send is clicked during an active run', async () => {
    const user = userEvent.setup();
    seedProcessingComposer('Steer the agent');

    render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Steer mid-run' })).toBeEnabled();
    });

    await user.click(screen.getByRole('button', { name: 'Steer mid-run' }));

    await waitFor(() => {
      expect(enqueueFollowUpMock).toHaveBeenCalledWith(
        'steering',
        'Steer the agent',
        { providerId: 'p1', modelId: 'm1' },
        {}
      );
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('enqueues queue lane when Queue is clicked during an active run', async () => {
    const user = userEvent.setup();
    seedProcessingComposer('After finish');

    render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Queue' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Queue' }));

    await waitFor(() => {
      expect(enqueueFollowUpMock).toHaveBeenCalledWith(
        'queue',
        'After finish',
        { providerId: 'p1', modelId: 'm1' },
        {}
      );
    });
  });

  it('shows the follow-up tray when queued items exist', () => {
    useChatStore.setState((state) => {
      const slice = {
        ...(state.slices.c1 ?? emptySlice('c1')),
        isProcessing: true,
        followUps: { steering: [], queued: [queuedItem()] }
      };
      return {
        ...state,
        slices: { ...state.slices, c1: slice },
        ...mirrorOf(slice)
      };
    });

    render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    expect(screen.getByTestId('follow-up-tray')).toBeInTheDocument();
    expect(screen.getByText('Queued task')).toBeInTheDocument();
  });

  it('updates a queued item in place when editing and saving', async () => {
    const user = userEvent.setup();
    useChatStore.setState((state) => {
      const slice = {
        ...(state.slices.c1 ?? emptySlice('c1')),
        isProcessing: true,
        followUps: { steering: [], queued: [queuedItem({ prompt: 'Queued task' })] }
      };
      return {
        ...state,
        conversationId: 'c1',
        slices: { ...state.slices, c1: slice },
        ...mirrorOf(slice),
        enqueueFollowUp: enqueueFollowUpMock,
        updateFollowUp: updateFollowUpMock,
        removeFollowUp: vi.fn(),
        sendFollowUpNow: vi.fn(),
        send: sendMock
      };
    });

    render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Edit queued follow-up' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });
    expect(screen.getByText('editing')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateFollowUpMock).toHaveBeenCalledWith('q-1', {
        prompt: 'Queued task',
        selection: { providerId: 'p1', modelId: 'm1' },
        attachmentMeta: [],
        mentions: []
      });
    });
    expect(enqueueFollowUpMock).not.toHaveBeenCalled();
  });

  it('Enter saves queued edit instead of steering', async () => {
    const user = userEvent.setup();
    useChatStore.setState((state) => {
      const slice = {
        ...(state.slices.c1 ?? emptySlice('c1')),
        isProcessing: true,
        followUps: { steering: [], queued: [queuedItem({ prompt: 'Queued task' })] }
      };
      return {
        ...state,
        conversationId: 'c1',
        slices: { ...state.slices, c1: slice },
        ...mirrorOf(slice),
        enqueueFollowUp: enqueueFollowUpMock,
        updateFollowUp: updateFollowUpMock,
        removeFollowUp: vi.fn(),
        sendFollowUpNow: vi.fn(),
        send: sendMock
      };
    });

    render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Edit queued follow-up' }));
    const textbox = await screen.findByRole('textbox');
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(updateFollowUpMock).toHaveBeenCalled();
    });
    expect(enqueueFollowUpMock).not.toHaveBeenCalled();
  });
});
