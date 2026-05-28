/**
 * LeftDock layout — expanded/collapsed width and tablist presence.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LeftDock } from '@renderer/components/dock/LeftDock';
import {
  DOCK_WIDTH_COLLAPSED_PX,
  DOCK_WIDTH_DEFAULT,
  DOCK_WIDTH_MAX
} from '@renderer/components/dock/dockShared';
import { useUiStore } from '@renderer/store/useUiStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useDockSearchStore } from '@renderer/store/useDockSearchStore';

beforeEach(() => {
  useUiStore.setState({
    dockExpanded: true,
    dockWidth: DOCK_WIDTH_DEFAULT,
    collapsedWorkspaces: new Set<string>(),
    hydrated: true
  });
  useDockSearchStore.setState({ open: false, query: '' });
  useWorkspaceStore.setState({
    activeId: 'ws-1',
    list: [{ id: 'ws-1', label: 'Codex', path: '/tmp/codex' }],
    loading: false
  } as never);
  useConversationsStore.setState({
    list: [
      {
        id: 'c1',
        title: 'analyze the',
        createdAt: 0,
        updatedAt: 0,
        eventCount: 0,
        workspaceId: 'ws-1'
      }
    ],
    activeIdByWorkspace: { 'ws-1': 'c1' },
    loading: false
  } as never);
});

describe('LeftDock layout', () => {
  it('renders expanded width and workspace/chat tablists', () => {
    render(<LeftDock />);
    const nav = screen.getByRole('navigation', { name: 'Workspace and session navigation' });
    expect(nav).toHaveStyle({ width: `${DOCK_WIDTH_DEFAULT}px` });
    expect(nav.className).toContain('bg-surface-base');
    expect(nav).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Chats in workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize navigation dock' })).toBeInTheDocument();
  });

  it('renders collapsed rail width with active workspace label', () => {
    useUiStore.setState({ dockExpanded: false });
    render(<LeftDock />);
    const nav = screen.getByRole('navigation', { name: 'Workspace and session navigation' });
    expect(nav).toHaveStyle({ width: `${DOCK_WIDTH_COLLAPSED_PX}px` });
    expect(nav).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Expand navigation.*Codex/i })).toBeInTheDocument();
  });

  it('uses dockWidth from the UI store when expanded', () => {
    useUiStore.setState({ dockWidth: 300 });
    render(<LeftDock />);
    const nav = screen.getByRole('navigation', { name: 'Workspace and session navigation' });
    expect(nav).toHaveStyle({ width: '300px' });
  });

  it('clamps width during drag and persists on mouseup', () => {
    useUiStore.setState({ dockWidth: DOCK_WIDTH_DEFAULT, dockExpanded: true });
    const setDockWidth = vi.spyOn(useUiStore.getState(), 'setDockWidth');
    render(<LeftDock />);
    const nav = screen.getByRole('navigation', { name: 'Workspace and session navigation' });
    const handle = screen.getByRole('separator', { name: 'Resize navigation dock' });

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 400 });
    expect(nav).toHaveStyle({ width: `${DOCK_WIDTH_MAX}px` });

    fireEvent.mouseUp(window);
    expect(setDockWidth).toHaveBeenCalledWith(DOCK_WIDTH_MAX);
  });

  it('opens search above the footer toolbar', () => {
    useDockSearchStore.setState({ open: true, query: 'tri' });
    render(<LeftDock />);
    const search = screen.getByRole('search', { name: 'Search chats' });
    const newChat = screen.getByRole('button', { name: 'New chat' });
    expect(search.compareDocumentPosition(newChat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('closes inline search when the dock collapses', () => {
    useDockSearchStore.setState({ open: true, query: 'tri' });
    const { rerender } = render(<LeftDock />);
    expect(useDockSearchStore.getState().open).toBe(true);

    useUiStore.setState({ dockExpanded: false });
    rerender(<LeftDock />);
    expect(useDockSearchStore.getState().open).toBe(false);
    expect(useDockSearchStore.getState().query).toBe('');
  });

  it('centers collapsed rail controls', () => {
    useUiStore.setState({ dockExpanded: false });
    render(<LeftDock />);
    const expand = screen.getByRole('button', { name: /Expand navigation.*Codex/i });
    const rail = expand.parentElement;
    expect(rail?.className ?? '').toMatch(/items-center/);
    expect(rail?.className ?? '').toMatch(/justify-center/);
  });
});
