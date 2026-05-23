/**
 * Window-level dock keyboard shortcuts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LeftDock } from '@renderer/components/dock/LeftDock';
import { useUiStore } from '@renderer/store/useUiStore';
import { useDockSearchStore } from '@renderer/store/useDockSearchStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

function fireKey(key: string, init: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init })
  );
}

beforeEach(() => {
  useUiStore.setState({
    dockExpanded: false,
    dockWidth: 260,
    collapsedWorkspaces: new Set<string>(),
    hydrated: true
  });
  useDockSearchStore.setState({ open: false, query: '' });
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    list: [{ id: 'ws-1', label: 'Codex', path: '/tmp' }]
  } as never);
  useConversationsStore.setState({
    list: [
      { id: 'c1', title: 'First', workspaceId: 'ws-1', createdAt: 0, updatedAt: 0, eventCount: 0 },
      { id: 'c2', title: 'Second', workspaceId: 'ws-1', createdAt: 0, updatedAt: 0, eventCount: 0 }
    ],
    activeIdByWorkspace: { 'ws-1': 'c1' }
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDockShortcuts via LeftDock mount', () => {
  it('Ctrl+B toggles dockExpanded', () => {
    render(<LeftDock />);
    expect(useUiStore.getState().dockExpanded).toBe(false);
    fireKey('b', { ctrlKey: true });
    expect(useUiStore.getState().dockExpanded).toBe(true);
  });

  it('Ctrl+K expands dock and opens search', () => {
    render(<LeftDock />);
    fireKey('k', { ctrlKey: true });
    expect(useUiStore.getState().dockExpanded).toBe(true);
    expect(useDockSearchStore.getState().open).toBe(true);
  });

  it('Alt+ArrowDown selects the next conversation', () => {
    const select = vi.spyOn(useConversationsStore.getState(), 'select');
    render(<LeftDock />);
    fireKey('ArrowDown', { altKey: true });
    expect(select).toHaveBeenCalledWith('c2');
  });

  it('Alt+ArrowUp selects the previous conversation', () => {
    useConversationsStore.setState({
      activeIdByWorkspace: { 'ws-1': 'c2' }
    } as never);
    const select = vi.spyOn(useConversationsStore.getState(), 'select');
    render(<LeftDock />);
    fireKey('ArrowUp', { altKey: true });
    expect(select).toHaveBeenCalledWith('c1');
  });

  it('ignores Alt+arrows when focus is in a text input', () => {
    const select = vi.spyOn(useConversationsStore.getState(), 'select');
    render(
      <>
        <LeftDock />
        <input data-testid="composer" />
      </>
    );
    const input = screen.getByTestId('composer');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true, bubbles: true });
    expect(select).not.toHaveBeenCalled();
  });
});
