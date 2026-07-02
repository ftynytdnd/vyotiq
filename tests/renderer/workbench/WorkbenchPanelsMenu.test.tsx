/**
 * WorkbenchPanelsMenu — compact titlebar companion launcher.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkbenchPanelsMenu } from '@renderer/components/workbench/WorkbenchPanelsMenu';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useWorkbenchPanelsStore } from '@renderer/store/useWorkbenchPanelsStore';
import { useUiStore } from '@renderer/store/useUiStore';

describe('WorkbenchPanelsMenu', () => {
  beforeEach(() => {
    useWorkbenchPanelsStore.setState({ open: false });
    useWorkspaceStore.setState({
      activeId: 'ws-1',
      info: { path: '/tmp/proj', label: 'Proj' }
    } as never);
    useUiStore.setState({ workbenchTab: null } as never);
  });

  it('opens a panel picker from a single titlebar control', async () => {
    const user = userEvent.setup();
    render(<WorkbenchPanelsMenu />);

    await user.click(screen.getByRole('button', { name: 'Companion panels' }));
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Browser')).toBeInTheDocument();
    expect(screen.getByText('Source control')).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
  });

  it('opens from the workbench panels store (keyboard shortcut)', async () => {
    render(<WorkbenchPanelsMenu />);
    await act(async () => {
      useWorkbenchPanelsStore.getState().setOpen(true);
    });
    expect(screen.getByText('Source control')).toBeInTheDocument();
  });
});
