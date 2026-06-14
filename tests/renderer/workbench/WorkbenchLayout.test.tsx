/**
 * Workbench layout — agent column on the left; workbench side pane on the right.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchShell } from '@renderer/components/workbench/WorkbenchShell';
import { WORKBENCH_SHELL_SPLIT_ROW_CLASS } from '@renderer/components/workbench/workbenchShared';
import { ChatPage } from '@renderer/pages/ChatPage';
import { useChatStore } from '@renderer/store/useChatStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useProviderStore } from '@renderer/store/useProviderStore';
import { useSettingsStore } from '@renderer/store/useSettingsStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useTerminalStore } from '@renderer/store/useTerminalStore';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useUiStore } from '@renderer/store/useUiStore';

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
        setAccountPollSource: vi.fn(async () => undefined)
      },
      completion: {
        cancel: vi.fn(async () => undefined),
        onEvent: subscribe
      },
      terminal: {
        attach: vi.fn(async () => ({ shell: 'powershell' })),
        detach: vi.fn(async () => undefined),
        input: vi.fn(async () => undefined),
        resize: vi.fn(async () => undefined),
        onData: subscribe,
        onExit: subscribe
      }
    }
  };
});

function seedFreshChat() {
  useChatStore.setState({
    events: [],
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
    list: [{ id: 'c1', title: 'New conversation', updatedAt: 1, workspaceId: 'ws-1' }],
    selecting: false,
    activeIdByWorkspace: { 'ws-1': 'c1' }
  } as never);
  useUiStore.setState({ workbenchTab: 'agent' });
  useEditorStore.setState({
    open: false,
    tabs: [],
    activeFilePath: null,
    filePath: null,
    workspaceId: null,
    content: '',
    savedContent: '',
    mtimeMs: null,
    truncated: false,
    loading: false,
    saving: false,
    staleOnDisk: false,
    error: null
  });
  useTerminalStore.setState({
    open: false,
    workspaceId: null,
    shellLabel: null,
    attaching: false,
    error: null
  });
}

function shellWithChat() {
  return (
    <div style={{ display: 'flex', height: 720, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>
      <WorkbenchShell>
        <ChatPage onOpenProviders={() => undefined} />
      </WorkbenchShell>
    </div>
  );
}

describe('Workbench layout', () => {
  beforeEach(() => {
    seedFreshChat();
  });

  it('shows centered composer when no companions are open', () => {
    render(shellWithChat());

    expect(document.querySelector('[data-chat-footer-centered]')).toBeTruthy();
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: /workbench/i })).toBeNull();
  });

  it('keeps centered composer visible beside the workbench side pane', () => {
    useTerminalStore.setState({
      open: true,
      workspaceId: 'ws-1',
      shellLabel: 'powershell',
      attaching: false
    });
    const { container } = render(shellWithChat());

    expect(container.querySelector(`.${WORKBENCH_SHELL_SPLIT_ROW_CLASS}`)).toBeTruthy();
    expect(screen.getByRole('tablist', { name: /workbench/i })).toBeTruthy();
    expect(document.querySelector('[data-chat-footer-centered]')).toBeTruthy();
    expect(document.querySelector('[data-workbench-agent-main] [role="textbox"]')).toBeTruthy();
    expect(document.querySelector('[data-workbench-agent-main]')).toBeTruthy();
    expect(document.querySelector('[data-workbench-pane]')).toBeTruthy();
  });

  it('wires flex height classes through agent main and chat footer', () => {
    const { container } = render(shellWithChat());
    const agentMain = container.querySelector('[data-workbench-agent-main]');
    const footer = document.querySelector('[data-chat-footer]');

    expect(agentMain?.className).toMatch(/flex-1/);
    expect(footer?.className).toMatch(/flex-1/);
  });

  it('keeps agent chat visible when side pane shows terminal', () => {
    useTerminalStore.setState({
      open: true,
      workspaceId: 'ws-1',
      shellLabel: 'powershell',
      attaching: false
    });
    useUiStore.setState({ workbenchTab: 'terminal' });

    render(shellWithChat());

    expect(document.querySelector('[data-workbench-agent-main]')).toBeTruthy();
    expect(document.querySelector('[data-workbench-agent-main] [role="textbox"]')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^powershell$/i })).toHaveAttribute('aria-selected', 'true');
  });
});
