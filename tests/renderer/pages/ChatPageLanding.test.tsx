/**
 * ChatPage — centered landing composer stays visible when dock is expanded.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from '@renderer/pages/ChatPage';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useUiStore } from '@renderer/store/useUiStore';

vi.mock('@renderer/pages/useLandingConversationPrewarm.js', () => ({
  useLandingConversationPrewarm: () => undefined
}));

beforeEach(() => {
  useChatStore.setState({ events: [], conversationId: null, isProcessing: false } as never);
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    info: { path: 'C:\\tmp\\agent' },
    list: [{ id: 'ws-1', label: 'Agent', path: 'C:\\tmp\\agent', addedAt: 0 }]
  } as never);
  useProviderStore.setState({
    providers: [{ id: 'p1', name: 'OpenRouter', enabled: true, models: [{ id: 'm1', name: 'M1' }] }]
  } as never);
  useSettingsStore.setState({
    loading: false,
    initialLoadDone: true,
    settings: { defaultModel: { providerId: 'p1', modelId: 'm1' } }
  } as never);
  useConversationsStore.setState({
    list: [],
    selecting: false,
    activeIdByWorkspace: {}
  } as never);
  useUiStore.setState({ dockExpanded: true, hydrated: true });
});

describe('ChatPage landing layout', () => {
  it('keeps centered landing composer when the dock flyout is expanded', () => {
    render(<ChatPage onOpenProviders={() => undefined} />);
    expect(document.querySelector('[data-chat-footer-centered]')).toBeTruthy();
    expect(document.querySelector('.vx-timeline-scroll-host')).toBeNull();
  });
});
