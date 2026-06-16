/**
 * WorkbenchShell — horizontal split: agent column + side pane.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkbenchShell } from '@renderer/components/workbench/WorkbenchShell';
import { WORKBENCH_SHELL_SPLIT_ROW_CLASS } from '@renderer/components/workbench/workbenchShared';
import { useEditorStore } from '@renderer/store/useEditorStore';
import { useTerminalStore } from '@renderer/store/useTerminalStore';
import { useUiStore } from '@renderer/store/useUiStore';

function shell(children = <p>Agent view</p>) {
  return <WorkbenchShell>{children}</WorkbenchShell>;
}

describe('WorkbenchShell', () => {
  beforeEach(() => {
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
      sessions: [],
      activeSessionId: null,
      splitSessionId: null,
      attaching: false,
      error: null
    } as never);
    useUiStore.setState({ workbenchTab: 'agent' });
  });

  it('uses full-width agent column when no companions are open', () => {
    const { container } = render(shell());
    expect(screen.queryByRole('tablist', { name: /workbench/i })).toBeNull();
    expect(container.querySelector('[data-workbench-pane]')).toBeNull();
    expect(container.querySelector('[data-workbench-launcher-rail]')).toBeNull();
    expect(container.textContent).toContain('Agent view');
    expect(container.querySelector('.vx-workbench--split-row')).toBeNull();
  });

  it('shows side pane when the editor is open', () => {
    useEditorStore.setState({ open: true });
    render(shell());
    expect(screen.getByRole('tablist', { name: /workbench/i })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: /^terminal$/i })).toBeNull();
    expect(screen.queryByRole('tab', { name: /^agent$/i })).toBeNull();
  });

  it('uses horizontal split layout when companions are open', () => {
    useTerminalStore.setState({ open: true, workspaceId: 'ws-1', attaching: false } as never);
    const { container } = render(shell());
    expect(container.querySelector(`.${WORKBENCH_SHELL_SPLIT_ROW_CLASS}`)).toBeTruthy();
    expect(container.querySelector('[data-workbench-agent-main]')).toBeTruthy();
    expect(container.querySelector('[data-workbench-pane]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Resize workbench pane"]')).toBeTruthy();
  });

  it('shows side pane when only the terminal is open', () => {
    useTerminalStore.setState({ open: true, workspaceId: 'ws-1', attaching: false } as never);
    render(shell());
    expect(screen.getByRole('tablist', { name: /workbench/i })).toBeTruthy();
  });

  it('shows editor empty state in side pane when editor is open without files', () => {
    useEditorStore.setState({ open: true });
    useUiStore.setState({ workbenchTab: 'editor' });
    render(shell());
    expect(screen.getByText(/no file open/i)).toBeTruthy();
    expect(screen.getByText('Agent view')).toBeTruthy();
  });

  it('keeps agent chat visible beside the workbench pane on terminal', () => {
    useEditorStore.setState({ open: true });
    useUiStore.setState({ workbenchTab: 'terminal' });
    useTerminalStore.setState({
      open: true,
      workspaceId: 'ws-1',
      sessions: [
        { sessionId: 's1', workspaceId: 'ws-1', shell: 'powershell', cols: 80, rows: 24, primary: true }
      ],
      activeSessionId: 's1',
      attaching: false
    } as never);
    render(shell(<p data-testid="agent-slot">Agent view</p>));
    expect(screen.getByTestId('agent-slot')).toBeTruthy();
    expect(document.querySelector('[data-workbench-agent-main]')).toBeTruthy();
    expect(document.querySelector('[data-workbench-pane]')).toBeTruthy();
  });
});
