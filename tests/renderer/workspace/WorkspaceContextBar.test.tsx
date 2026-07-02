/**
 * WorkspaceContextBar — interactive landing and breadcrumb context.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceContextBar } from '@renderer/components/workspace/WorkspaceContextBar';
import { useUiStore } from '@renderer/store/useUiStore';
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore';

vi.mock('@renderer/lib/ipc.js', () => ({
  vyotiq: {
    workspace: {
      gitStatus: vi.fn(async () => ({
        paths: { 'src/a.ts': 'M' as const },
        context: { isRepo: true, branch: 'main', headShort: 'abc', dirtyCount: 3 }
      })),
      gitFileDiff: vi.fn(async () => ({
        path: 'src/a.ts',
        status: 'M' as const,
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            lines: [{ kind: '+' as const, text: 'line' }]
          }
        ]
      }))
    }
  }
}));

describe('WorkspaceContextBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ dockExpanded: false, hydrated: true } as never);
    useWorkspaceStore.setState({
      activeId: 'ws-1',
      list: [{ id: 'ws-1', label: 'vyotiq', path: '/tmp/vyotiq' }]
    } as never);
  });

  it('opens the navigator when workspace is clicked', async () => {
    const user = userEvent.setup();
    render(<WorkspaceContextBar workspaceId="ws-1" workspaceLabel="vyotiq" variant="landing" />);

    await user.click(await screen.findByRole('button', { name: 'Workspace vyotiq' }));
    expect(useUiStore.getState().dockExpanded).toBe(true);
  });

  it('opens source control panel when dirty count is clicked', async () => {
    const user = userEvent.setup();
    render(<WorkspaceContextBar workspaceId="ws-1" workspaceLabel="vyotiq" variant="landing" />);

    await user.click(await screen.findByRole('button', { name: '3 uncommitted changes' }));
    expect(await screen.findByRole('listbox', { name: 'Changed files' })).toBeInTheDocument();
    expect(screen.getByText('Source control')).toBeInTheDocument();
  });
});
