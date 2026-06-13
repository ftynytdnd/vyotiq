/**
 * ChatPage — survives terminal toggles and agent-run poll registration.
 */

import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPage } from '@renderer/pages/ChatPage';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useTerminalStore } from '@renderer/store/useTerminalStore';
import { __test_resetProviderAccountPollRegistrations } from '@renderer/lib/useProviderAccountPollSource';

const setAccountPollSource = vi.fn(async () => undefined);

vi.mock('@renderer/pages/useLandingConversationPrewarm.js', () => ({
  useLandingConversationPrewarm: () => undefined
}));

vi.mock('@renderer/lib/ipc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/lib/ipc.js')>();
  const subscribe = () => () => undefined;
  return {
    ...actual,
    vyotiq: {
      ...actual.vyotiq,
      providers: {
        ...actual.vyotiq.providers,
        setAccountPollSource: (...args: unknown[]) => setAccountPollSource(...args)
      },
      completion: {
        cancel: vi.fn(async () => undefined),
        onEvent: subscribe
      }
    }
  };
});

beforeEach(() => {
  __test_resetProviderAccountPollRegistrations();
  setAccountPollSource.mockClear();
  useChatStore.setState({
    events: [{ kind: 'user-prompt', id: 'p1', ts: 1, content: 'hi', runId: 'r1' }],
    conversationId: 'c1',
    isProcessing: false
  } as never);
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    info: { path: 'C:\\tmp\\agent' },
    list: [{ id: 'ws-1', label: 'Agent', path: 'C:\\tmp\\agent', addedAt: 0 }]
  } as never);
  useProviderStore.setState({
    providers: [
      {
        id: 'p1',
        name: 'OpenRouter',
        enabled: true,
        models: [{ id: 'm1', name: 'Model 1' }]
      }
    ]
  } as never);
  useSettingsStore.setState({
    loading: false,
    initialLoadDone: true,
    settings: { defaultModel: { providerId: 'p1', modelId: 'm1' } }
  } as never);
  useConversationsStore.setState({
    list: [{ id: 'c1', title: 'Chat', updatedAt: 1, workspaceId: 'ws-1' }],
    selecting: false,
    activeIdByWorkspace: { 'ws-1': 'c1' }
  } as never);
  useTerminalStore.setState({ open: false } as never);
});

describe('ChatPage', () => {
  it('survives opening the editor overlay without hook errors', () => {
    render(<ChatPage onOpenProviders={() => undefined} />);

    act(() => {
      useEditorStore.setState({ open: true } as never);
      useEditorStore.setState({ open: false } as never);
      useEditorStore.setState({ open: true } as never);
    });

    expect(setAccountPollSource).toHaveBeenCalled();
  });

  it('survives rapid terminal toggles without hook errors', () => {
    render(<ChatPage onOpenProviders={() => undefined} />);

    act(() => {
      useTerminalStore.setState({ open: true });
      useTerminalStore.setState({ open: false });
      useTerminalStore.setState({ open: true });
      useChatStore.setState({ isProcessing: true } as never);
      useChatStore.setState({ isProcessing: false } as never);
    });

    expect(setAccountPollSource).toHaveBeenCalled();
  });

  it('survives rapid conversation switches with agent-run poll toggles', () => {
    const { rerender } = render(<ChatPage onOpenProviders={() => undefined} />);

    act(() => {
      useConversationsStore.setState({
        list: [
          { id: 'c1', title: 'Chat 1', updatedAt: 1, workspaceId: 'ws-1' },
          { id: 'c2', title: 'Chat 2', updatedAt: 2, workspaceId: 'ws-1' }
        ],
        activeIdByWorkspace: { 'ws-1': 'c1' }
      } as never);
    });

    rerender(<ChatPage onOpenProviders={() => undefined} />);

    act(() => {
      useConversationsStore.setState({ activeIdByWorkspace: { 'ws-1': 'c2' } } as never);
      useChatStore.setState({ isProcessing: true, conversationId: 'c2' } as never);
      useChatStore.setState({ isProcessing: false } as never);
    });

    rerender(<ChatPage onOpenProviders={() => undefined} />);
    expect(setAccountPollSource).toHaveBeenCalled();
  });
});
