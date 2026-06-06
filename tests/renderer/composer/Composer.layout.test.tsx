/**
 * Composer layout — inline send beside textarea; compact chip row.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Composer } from '@renderer/components/composer/Composer';
import { useChatStore } from '@renderer/store/useChatStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

vi.mock('@renderer/components/composer/useComposerAttachments.js', () => ({
  useComposerAttachments: () => ({
    attachments: [],
    pickFromComputer: vi.fn(),
    remove: vi.fn(),
    clearAttachments: vi.fn(),
    peekPendingMessageId: vi.fn(),
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

beforeEach(() => {
  useChatStore.setState({
    ...INITIAL_TIMELINE_STATE,
    conversationId: 'c1',
    isProcessing: false,
    send: vi.fn(),
    abort: vi.fn(),
    setDraft: vi.fn(),
    draft: ''
  });
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    list: [{ id: 'ws-1', label: 'Demo', path: '/tmp/demo' }],
    loading: false
  } as never);
  useSettingsStore.setState({
    settings: { permissions: { mode: 'ask' } }
  } as never);
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

describe('Composer layout', () => {
  it('renders send in the composer grid beside the textarea', () => {
    const { container } = render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    expect(container.querySelector('.vx-composer-editor-slot [contenteditable="true"]')).not.toBeNull();
    expect(container.querySelector('.vx-composer-send-slot')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('shows ask-user hint in the status strip', () => {
    useChatStore.setState({
      awaitingAskUser: true,
      events: [
        {
          kind: 'ask-user-prompt',
          id: 'q1',
          ts: 1,
          status: 'pending',
          payload: { title: 'Pick a color', questions: [] }
        }
      ]
    } as never);

    render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    expect(screen.getByText(/Reply needed/i)).toBeInTheDocument();
    expect(screen.getByText(/Pick a color/i)).toBeInTheDocument();
  });
});
