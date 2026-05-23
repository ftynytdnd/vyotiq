/**
 * focusRow — cross-workspace navigation and collapsed workspace expand.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { focusRow, __resetChatRowRegistry } from '@renderer/hooks/chat/useChatRowFocus';
import { useUiStore } from '@renderer/store/useUiStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';

beforeEach(() => {
  __resetChatRowRegistry();
  useUiStore.setState({
    dockExpanded: false,
    dockWidth: 260,
    collapsedWorkspaces: new Set<string>(),
    hydrated: true
  });
});

describe('focusRow integration', () => {
  it('switches workspace, clears collapse, selects chat, and expands dock', async () => {
    const setActive = vi.fn().mockResolvedValue(undefined);
    const select = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      activeId: 'ws-home',
      list: [
        { id: 'ws-home', label: 'Home', path: '/home' },
        { id: 'ws-other', label: 'Other', path: '/other' }
      ],
      setActive
    } as never);
    useConversationsStore.setState({
      list: [
        {
          id: 'conv-remote',
          title: 'Remote run',
          workspaceId: 'ws-other',
          createdAt: 0,
          updatedAt: 0,
          eventCount: 0
        }
      ],
      activeIdByWorkspace: { 'ws-home': 'conv-home', 'ws-other': 'conv-other' },
      select
    } as never);
    useUiStore.setState({ collapsedWorkspaces: new Set(['ws-other']) });

    focusRow('conv-remote');

    expect(useUiStore.getState().dockExpanded).toBe(true);
    await vi.waitFor(() => {
      expect(setActive).toHaveBeenCalledWith('ws-other');
      expect(select).toHaveBeenCalledWith('conv-remote');
      expect(useUiStore.getState().collapsedWorkspaces.has('ws-other')).toBe(false);
    });
  });
});
