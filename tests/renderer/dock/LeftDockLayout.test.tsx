/**
 * LeftDock layout — edge strip + inline nav panel.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LeftDock } from '@renderer/components/dock/LeftDock';
import { DOCK_WIDTH_DEFAULT, DOCK_WIDTH_MAX } from '@renderer/components/dock/dockShared';
import { useUiStore } from '@renderer/store/useUiStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useConversationsStore } from '@renderer/store/useConversationsStore';
import { useDockSearchStore } from '@renderer/store/useDockSearchStore';

const dockProps = {
  onOpenWorkspace: () => {},
  onSetWorkspacePath: () => {}
};

beforeEach(() => {
  useUiStore.setState({
    dockExpanded: true,
    dockWidth: DOCK_WIDTH_DEFAULT,
    dockPanelTab: 'chats',
    filesExpandedWorkspaces: new Set<string>(),
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
  it('renders expanded inline panel with workspace tree and session list', () => {
    render(<LeftDock {...dockProps} />);
    const nav = screen.getByRole('navigation', { name: 'Workspace and session navigation' });
    expect(nav).toHaveStyle({ width: `${DOCK_WIDTH_DEFAULT}px` });
    expect(nav.className).toContain('vx-dock-panel');
    expect(screen.getByRole('heading', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByRole('tree', { name: 'Workspaces' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Chats in workspace' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize navigation dock' })).toBeInTheDocument();
  });

  it('does not render edge strip when collapsed', () => {
    useUiStore.setState({ dockExpanded: false });
    render(<LeftDock {...dockProps} />);
    expect(screen.queryByRole('navigation', { name: 'Workspace and session navigation' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Workspace and session navigation rail' })).toBeNull();
  });

  it('does not render a dismiss backdrop when expanded', () => {
    render(<LeftDock {...dockProps} />);
    expect(screen.queryByRole('button', { name: 'Close navigation' })).toBeNull();
  });

  it('uses dockWidth from the UI store when expanded', () => {
    useUiStore.setState({ dockWidth: 300 });
    render(<LeftDock {...dockProps} />);
    const nav = screen.getByRole('navigation', { name: 'Workspace and session navigation' });
    expect(nav).toHaveStyle({ width: '300px' });
  });

  it('clamps width during drag and persists on mouseup', () => {
    useUiStore.setState({ dockWidth: DOCK_WIDTH_DEFAULT, dockExpanded: true });
    const setDockWidth = vi.spyOn(useUiStore.getState(), 'setDockWidth');
    render(<LeftDock {...dockProps} />);
    const nav = screen.getByRole('navigation', { name: 'Workspace and session navigation' });
    const handle = screen.getByRole('separator', { name: 'Resize navigation dock' });

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 400 });
    expect(nav).toHaveStyle({ width: `${DOCK_WIDTH_MAX}px` });

    fireEvent.mouseUp(window);
    expect(setDockWidth).toHaveBeenCalledWith(DOCK_WIDTH_MAX);
  });

  it('opens unified search at top of flyout', () => {
    useDockSearchStore.setState({ open: true, query: 'tri' });
    render(<LeftDock {...dockProps} />);
    expect(screen.getByRole('search', { name: 'Search workspace' })).toBeInTheDocument();
  });

  it('closes inline search when the dock collapses', () => {
    useDockSearchStore.setState({ open: true, query: 'tri' });
    const { rerender } = render(<LeftDock {...dockProps} />);
    expect(useDockSearchStore.getState().open).toBe(true);

    useUiStore.setState({ dockExpanded: false });
    rerender(<LeftDock {...dockProps} />);
    expect(useDockSearchStore.getState().open).toBe(false);
    expect(useDockSearchStore.getState().query).toBe('');
  });

  it('marks resize handle while dragging', () => {
    render(<LeftDock {...dockProps} />);
    const handle = screen.getByRole('separator', { name: 'Resize navigation dock' });
    expect(handle).not.toHaveAttribute('data-resizing');

    fireEvent.mouseDown(handle, { clientX: 100 });
    expect(handle).toHaveAttribute('data-resizing', 'true');

    fireEvent.mouseUp(window);
    expect(handle).not.toHaveAttribute('data-resizing');
  });

  it('collapses files for the active workspace when chats are focused via store', () => {
    useUiStore.setState({
      dockPanelTab: 'files',
      filesExpandedWorkspaces: new Set(['ws-1']),
      dockExpanded: true
    });
    render(<LeftDock {...dockProps} />);
    useUiStore.getState().setDockPanelTab('chats');
    expect(useUiStore.getState().dockPanelTab).toBe('chats');
    expect(useUiStore.getState().filesExpandedWorkspaces.has('ws-1')).toBe(false);
  });

  it('does not render panel while settings mode is active', () => {
    useUiStore.setState({ dockExpanded: true });
    render(<LeftDock {...dockProps} settingsMode />);
    expect(screen.queryByRole('navigation', { name: 'Workspace and session navigation' })).toBeNull();
  });
});
