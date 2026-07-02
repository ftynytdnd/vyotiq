/**
 * WorkbenchLaunchers — titlebar horizontal layout.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkbenchLaunchers } from '@renderer/components/workbench/WorkbenchLaunchers';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';
import { useUiStore } from '@renderer/store/useUiStore';
import { useTerminalStore } from '@renderer/store/useTerminalStore';

describe('WorkbenchLaunchers', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeId: 'ws-1',
      info: { path: 'C:\\proj' }
    } as never);
    useUiStore.setState({
      dockExpanded: false,
      filesExpandedWorkspaces: new Set(['ws-1']),
      workbenchTab: 'terminal',
      hydrated: true
    });
    useTerminalStore.setState({ open: false } as never);
  });

  it('renders horizontal terminal, browser, and editor launchers', () => {
    render(
      <WorkbenchLaunchers
        terminalOpen={false}
        browserOpen={false}
        editorOpen={false}
      />
    );
    expect(screen.getByRole('button', { name: /open terminal/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open browser/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open files to edit/i })).toBeTruthy();
  });

  it('opens the dock files panel instead of an empty editor pane', () => {
    render(
      <WorkbenchLaunchers
        titlebarMode
        terminalOpen={false}
        browserOpen={false}
        editorOpen={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /open files to edit/i }));
    expect(useUiStore.getState().dockExpanded).toBe(true);
    expect(useUiStore.getState().filesExpandedWorkspaces.has('ws-1')).toBe(true);
  });

  it('closes the focused terminal when its titlebar launcher is clicked again', () => {
    useTerminalStore.setState({ open: true } as never);
    render(
      <WorkbenchLaunchers
        titlebarMode
        terminalOpen
        browserOpen={false}
        editorOpen={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /close terminal/i }));
    expect(useTerminalStore.getState().open).toBe(false);
  });
});
