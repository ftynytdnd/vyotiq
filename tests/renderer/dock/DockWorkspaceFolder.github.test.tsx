/**
 * DockWorkspaceFolder — GitHub-bound workspace labels.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DockWorkspaceFolder } from '@renderer/components/dock/DockWorkspaceFolder';
import { useConversationsStore } from '@renderer/store/useConversationsStore';

const GITHUB_WS = {
  id: 'ws-gh',
  label: 'vyotiq',
  path: 'C:\\Users\\admin\\AppData\\vyotiq\\repos\\octocat\\github.com\\vyotiq\\vyotiq',
  addedAt: 0,
  source: 'github' as const,
  github: {
    accountId: 'acct-1',
    host: 'github.com',
    owner: 'vyotiq',
    repo: 'vyotiq',
    branch: 'main'
  }
};

const folderProps = {
  active: true,
  expanded: true,
  onSetWorkspacePath: () => {},
  onToggleExpanded: () => {},
  onActivate: () => {}
};

beforeEach(() => {
  useConversationsStore.setState({ list: [], activeIdByWorkspace: {}, loading: false } as never);
});

describe('DockWorkspaceFolder GitHub', () => {
  it('shows repo subtitle and branch meta for inactive github workspaces', () => {
    render(
      <DockWorkspaceFolder
        {...folderProps}
        workspace={GITHUB_WS}
        active={false}
        expanded={false}
      />
    );
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.queryByText('vyotiq/vyotiq @ main')).toBeNull();
  });

  it('shows github subtitle under active expanded workspace', () => {
    render(<DockWorkspaceFolder {...folderProps} workspace={GITHUB_WS} />);
    expect(screen.getByText('vyotiq/vyotiq @ main')).toBeInTheDocument();
  });
});
