/**
 * Composer layout — inline send beside textarea; attachment chips in toolbar row.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import { Composer } from '@renderer/components/composer/Composer';
import { useChatStore } from '@renderer/store/useChatStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { INITIAL_TIMELINE_STATE } from '@renderer/components/timeline/reducer/types';

const attachmentMock = vi.hoisted(() => ({
  attachments: [] as PromptAttachmentMeta[],
  isIngesting: false
}));

vi.mock('@renderer/components/composer/useComposerAttachments.js', () => ({
  useComposerAttachments: () => ({
    attachments: attachmentMock.attachments,
    setAttachments: vi.fn(),
    pickFromComputer: vi.fn(),
    remove: vi.fn(),
    clearAttachments: vi.fn(),
    peekPendingMessageId: vi.fn(() => 'msg-1'),
    onDrop: vi.fn(),
    onDragOver: vi.fn(),
    onPaste: vi.fn(),
    isIngesting: attachmentMock.isIngesting
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
  attachmentMock.attachments = [];
  attachmentMock.isIngesting = false;
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
    settings: {}
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

  it('renders attachment chips in the toolbar after screen capture', () => {
    attachmentMock.attachments = [
      {
        id: 'a1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        workspacePath: 'notes.txt'
      }
    ];

    const { container } = render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    const chipRow = container.querySelector('.vx-composer-chip-row');
    const attachZone = container.querySelector('.vx-composer-attach-zone');
    const attachChips = container.querySelector('.vx-composer-attach-chips');

    expect(chipRow).toHaveClass('vx-composer-chip-row--has-attachments');
    expect(attachZone).not.toBeNull();
    expect(attachChips).not.toBeNull();
    expect(chipRow?.querySelector('.vx-attachment-chip')).not.toBeNull();
    expect(container.querySelector('.vx-composer-attachment-row')).toBeNull();
    expect(attachZone?.querySelector('.vx-composer-attachment-count')?.textContent).toBe('1/10');
    expect(attachZone?.getAttribute('aria-label')).toBe('1 attached file');
  });

  it('keeps multiple attachment chips in one horizontal scroll row', () => {
    attachmentMock.attachments = Array.from({ length: 4 }, (_, index) => ({
      id: `a${index + 1}`,
      name: `Screen Recording ${index + 1}.mp4`,
      mimeType: 'video/mp4',
      workspacePath: `capture-${index + 1}.mp4`,
      mediaKind: 'video' as const
    }));

    const { container } = render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    const attachChips = container.querySelector('.vx-composer-attach-chips');
    expect(attachChips?.children).toHaveLength(4);
    expect(attachChips?.querySelectorAll('.vx-attachment-chip')).toHaveLength(4);
    expect(container.querySelector('.vx-composer-attach-zone')?.getAttribute('aria-label')).toBe(
      '4 attached files'
    );
  });

  it('sets aria-busy on the shell while ingest is in progress', () => {
    attachmentMock.isIngesting = true;

    const { container } = render(
      <Composer
        model={{ providerId: 'p1', modelId: 'm1' }}
        onModelChange={() => {}}
        onOpenProviders={() => {}}
      />
    );

    expect(container.querySelector('[data-composer-shell]')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[data-e2e-can-attach]')?.getAttribute('data-e2e-can-attach')).toBe(
      'false'
    );
  });
});
