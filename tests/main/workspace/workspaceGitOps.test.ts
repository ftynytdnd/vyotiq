import { describe, expect, it } from 'vitest';
import {
  gitCommit,
  gitResolveSyncRemote,
  gitUnstage,
  gitUnstageAll,
  resolveSyncBranchName
} from '../../../src/main/workspace/workspaceGitOps.js';
import { GitUserError } from '../../../src/main/workspace/gitUserError.js';
import type { WorkspaceGitRun } from '../../../src/main/workspace/workspaceGitRunner.js';

describe('workspaceGitOps', () => {
  it('gitResolveSyncRemote prefers branch upstream remote', async () => {
    const calls: string[][] = [];
    const gitRun: WorkspaceGitRun = async (args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return 'upstream/main';
      if (args[0] === 'remote') return 'origin\nupstream\n';
      return '';
    };
    const remote = await gitResolveSyncRemote(gitRun, 'feature');
    expect(remote).toBe('upstream');
    expect(calls[0]).toEqual([
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      'feature@{upstream}'
    ]);
  });

  it('gitResolveSyncRemote falls back to origin', async () => {
    const gitRun: WorkspaceGitRun = async (args) => {
      if (args[0] === 'rev-parse') throw new Error('no upstream');
      if (args[0] === 'remote') return 'origin\n';
      return '';
    };
    expect(await gitResolveSyncRemote(gitRun, 'main')).toBe('origin');
  });

  it('gitResolveSyncRemote returns null when no remotes', async () => {
    const gitRun: WorkspaceGitRun = async (args) => {
      if (args[0] === 'rev-parse') throw new Error('no upstream');
      if (args[0] === 'remote') return '';
      return '';
    };
    expect(await gitResolveSyncRemote(gitRun, null)).toBeNull();
  });

  it('resolveSyncBranchName prefers explicit branch', async () => {
    const gitRun: WorkspaceGitRun = async () => 'main';
    expect(await resolveSyncBranchName(gitRun, { branch: 'feature' })).toBe('feature');
  });

  it('resolveSyncBranchName falls back to github binding branch', async () => {
    const gitRun: WorkspaceGitRun = async () => {
      throw new Error('should not call git');
    };
    expect(
      await resolveSyncBranchName(gitRun, { githubBranch: 'develop' })
    ).toBe('develop');
  });

  it('resolveSyncBranchName uses current branch when not detached', async () => {
    const gitRun: WorkspaceGitRun = async (args) => {
      if (args[0] === 'rev-parse') return 'main';
      return '';
    };
    expect(await resolveSyncBranchName(gitRun, {})).toBe('main');
  });

  it('resolveSyncBranchName throws on detached HEAD without branch', async () => {
    const gitRun: WorkspaceGitRun = async (args) => {
      if (args[0] === 'rev-parse') return 'HEAD';
      return '';
    };
    await expect(resolveSyncBranchName(gitRun, {})).rejects.toThrow(GitUserError);
    await expect(resolveSyncBranchName(gitRun, {})).rejects.toThrow(/detached HEAD/);
  });

  it('gitCommit amend with empty message uses --no-edit', async () => {
    const calls: string[][] = [];
    const gitRun: WorkspaceGitRun = async (args) => {
      calls.push(args);
      return '';
    };
    await gitCommit(gitRun, '', { amend: true });
    expect(calls).toEqual([['commit', '--amend', '--no-edit']]);
  });

  it('gitCommit amend with message uses -m', async () => {
    const calls: string[][] = [];
    const gitRun: WorkspaceGitRun = async (args) => {
      calls.push(args);
      return '';
    };
    await gitCommit(gitRun, 'fix typo', { amend: true });
    expect(calls).toEqual([['commit', '--amend', '-m', 'fix typo']]);
  });

  it('gitCommit rejects empty message when not amending', async () => {
    const gitRun: WorkspaceGitRun = async () => '';
    await expect(gitCommit(gitRun, '   ')).rejects.toThrow(GitUserError);
  });

  it('gitUnstage uses rm --cached when repo has no commits', async () => {
    const calls: string[][] = [];
    const gitRun: WorkspaceGitRun = async (args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') throw new Error("fatal: Needed a single revision");
      return '';
    };
    await gitUnstage(gitRun, ['new.txt']);
    expect(calls).toContainEqual(['rm', '--cached', '--', 'new.txt']);
  });

  it('gitUnstageAll uses rm -r --cached when repo has no commits', async () => {
    const calls: string[][] = [];
    const gitRun: WorkspaceGitRun = async (args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') throw new Error("fatal: Needed a single revision");
      if (args[0] === 'diff' && args[1] === '--cached') return 'a.txt\n';
      return '';
    };
    await gitUnstageAll(gitRun);
    expect(calls).toContainEqual(['rm', '-r', '--cached', '.']);
  });

  it('gitUnstage uses restore --staged when repo has commits', async () => {
    const calls: string[][] = [];
    const gitRun: WorkspaceGitRun = async (args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') return 'abc123';
      return '';
    };
    await gitUnstage(gitRun, ['a.txt']);
    expect(calls).toContainEqual(['restore', '--staged', '--', 'a.txt']);
  });
});
