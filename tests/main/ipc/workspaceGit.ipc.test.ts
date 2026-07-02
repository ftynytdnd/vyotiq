import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const gitStageMock = vi.hoisted(() => vi.fn(async () => undefined));
const gitCommitMock = vi.hoisted(() => vi.fn(async () => undefined));
const generateGitCommitMessageMock = vi.hoisted(() => vi.fn(async () => 'chore: update'));

vi.mock('@main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: vi.fn(async () => '/tmp/ws'),
  listWorkspaces: vi.fn(async () => ({
    workspaces: [{ id: 'ws-1', path: '/tmp/ws', label: 'ws', addedAt: 0 }]
  })),
  updateWorkspaceGitHubBinding: vi.fn()
}));

vi.mock('@main/workspace/workspaceGitRunner.js', () => ({
  createWorkspaceGitRunner: vi.fn(async () => vi.fn()),
  notifyWorkspaceGitChanged: vi.fn()
}));

vi.mock('@main/workspace/workspaceGitOps.js', () => ({
  gitStage: (...args: unknown[]) => gitStageMock(...args),
  gitStageAll: vi.fn(),
  gitUnstage: vi.fn(),
  gitUnstageAll: vi.fn(),
  gitCommit: (...args: unknown[]) => gitCommitMock(...args),
  gitDiscard: vi.fn(),
  gitDiscardAll: vi.fn(),
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitRemoteHasUpstream: vi.fn(),
  gitResolveSyncRemote: vi.fn(),
  gitListBranches: vi.fn(),
  gitCheckoutBranch: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitCurrentBranch: vi.fn(),
  gitStashPush: vi.fn(),
  gitStashPop: vi.fn(),
  gitStashDrop: vi.fn(),
  gitStashList: vi.fn(),
  resolveSyncBranchName: vi.fn()
}));

vi.mock('@main/workspace/workspaceGitCommitMessage.js', () => ({
  generateGitCommitMessage: (...args: unknown[]) => generateGitCommitMessageMock(...args)
}));

vi.mock('@main/github/gitRunner.js', () => ({
  fetchAndCheckout: vi.fn()
}));

vi.mock('@main/github/githubAccountsStore.js', () => ({
  getGitHubAccountWithToken: vi.fn()
}));

vi.mock('@main/github/githubGitProgress.js', () => ({
  emitGitHubGitDone: vi.fn(),
  gitProgressContext: { run: vi.fn((_ctx: unknown, fn: () => unknown) => fn()) }
}));

beforeEach(async () => {
  gitStageMock.mockClear();
  gitCommitMock.mockClear();
  generateGitCommitMessageMock.mockReset();
  generateGitCommitMessageMock.mockResolvedValue('chore: update');
  mockIpc.__handlers.clear();
  const { registerWorkspaceGitIpc } = await import('@main/ipc/workspaceGit.ipc.js');
  registerWorkspaceGitIpc();
});

describe('workspaceGit IPC', () => {
  it('workspace:git-stage stages explicit paths', async () => {
    const result = await mockIpc.__invoke(IPC.WORKSPACE_GIT_STAGE, {
      workspaceId: 'ws-1',
      paths: ['src/a.ts']
    });
    expect(gitStageMock).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it('workspace:git-commit forwards message to gitCommit', async () => {
    await mockIpc.__invoke(IPC.WORKSPACE_GIT_COMMIT, {
      workspaceId: 'ws-1',
      message: 'feat: add tests'
    });
    expect(gitCommitMock).toHaveBeenCalledWith(
      expect.any(Function),
      'feat: add tests',
      expect.any(Object)
    );
  });

  it('workspace:git-discard rejects empty path list', async () => {
    await expect(
      mockIpc.__invoke(IPC.WORKSPACE_GIT_DISCARD, {
        workspaceId: 'ws-1',
        paths: []
      })
    ).rejects.toThrow(/paths/);
  });

  it('workspace:git-generate-commit-message returns soft error for GitUserError', async () => {
    const { GitUserError } = await import('@main/workspace/gitUserError.js');
    generateGitCommitMessageMock.mockRejectedValueOnce(new GitUserError('No changes to summarize.'));

    const result = await mockIpc.__invoke(IPC.WORKSPACE_GIT_GENERATE_COMMIT_MESSAGE, {
      workspaceId: 'ws-1',
      requestId: 'req-1'
    });

    expect(result).toEqual({ message: '', error: 'No changes to summarize.' });
  });
});
