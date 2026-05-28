/**
 * DockChatStrip — POL-2 rename on double-click only; POL-14 archived collapsed default.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DockChatStrip } from '@renderer/components/dock/DockChatStrip';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useChatStore } from '@renderer/store/useChatStore';
import { useDockSearchStore } from '@renderer/store/useDockSearchStore';
import { useUiStore } from '@renderer/store/useUiStore';
import type { ConversationMeta } from '@shared/types/chat';

const WS = 'ws-1';

function meta(id: string, title: string, archived = false): ConversationMeta {
  return {
    id,
    title,
    workspaceId: WS,
    createdAt: 0,
    updatedAt: 0,
    eventCount: 0,
    ...(archived ? { archived: true, archivedAt: 1 } : {})
  };
}

beforeEach(() => {
  useConversationsStore.setState({
    list: [meta('c1', 'Alpha'), meta('c-arch', 'Old chat', true)],
    loading: false,
    activeIdByWorkspace: { [WS]: 'c1' },
    select: vi.fn(async () => {}),
    prewarm: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
    unarchive: vi.fn(async () => {}),
    newConversationFor: vi.fn(async () => {})
  });
  useChatStore.setState({ slices: {} });
  useDockSearchStore.setState({ query: '', open: false });
  useUiStore.setState({ collapsedWorkspaces: new Set() });
});

describe('DockChatStrip', () => {
  it('does not expose a hover rename control — only double-click edits', async () => {
    render(<DockChatStrip workspaceId={WS} />);
    expect(screen.queryByLabelText('Rename chat')).toBeNull();
    expect(screen.queryByRole('button', { name: /rename/i })).toBeNull();

    const tab = screen.getByRole('tab', { name: /Alpha/i });
    const trigger = tab.querySelector('button.vx-dock-tab-trigger');
    expect(trigger).not.toBeNull();
    await userEvent.dblClick(trigger!);
    expect(screen.getByLabelText('Rename chat')).toBeInTheDocument();
  });

  it('keeps archived section collapsed by default', () => {
    render(<DockChatStrip workspaceId={WS} />);
    const toggle = screen.getByRole('button', { name: /Archived \(1\)/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tab', { name: /Old chat/i })).toBeNull();
  });

  it('reveals archived chats when the section is expanded', async () => {
    render(<DockChatStrip workspaceId={WS} />);
    await userEvent.click(screen.getByRole('button', { name: /Archived \(1\)/i }));
    expect(screen.getByRole('tab', { name: /Old chat/i })).toBeInTheDocument();
  });
});
