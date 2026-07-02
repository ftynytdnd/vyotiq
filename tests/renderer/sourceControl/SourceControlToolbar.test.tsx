/**
 * Source control toolbar — branch chip and compact sync actions.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourceControlToolbar } from '@renderer/components/sourceControl/SourceControlToolbar';
import type { WorkspaceGitContext } from '@shared/types/ipc.js';

const context: WorkspaceGitContext = {
  isRepo: true,
  branch: 'main',
  headShort: 'abc1234',
  dirtyCount: 2,
  ahead: 1,
  behind: 2,
  remote: 'origin'
};

const baseProps = {
  branchLabel: 'main',
  syncSuffix: ' ↑1 ↓2',
  context,
  totalChanges: 3,
  busy: false,
  branchOpen: false,
  onBranchToggle: vi.fn(),
  onRefresh: vi.fn(),
  onFetch: vi.fn(),
  onPull: vi.fn(),
  onPush: vi.fn()
};

describe('SourceControlToolbar', () => {
  it('renders branch chip with change count', () => {
    render(<SourceControlToolbar {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Branch main ↑1 ↓2' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('disables pull when not behind and invokes fetch on click', async () => {
    const onFetch = vi.fn();
    const user = userEvent.setup();
    render(
      <SourceControlToolbar
        {...baseProps}
        context={{ ...context, behind: 0 }}
        onFetch={onFetch}
      />
    );
    const pull = screen.getByRole('button', { name: 'Pull' });
    expect(pull).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Fetch' }));
    expect(onFetch).toHaveBeenCalledTimes(1);
  });
});
