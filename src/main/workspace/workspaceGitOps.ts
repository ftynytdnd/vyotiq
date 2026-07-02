/**
 * Git write operations for workspace source control — stage, commit, sync, stash.
 */

import type { GitPathStatus } from '@shared/types/ipc.js';
import type { WorkspaceGitRun } from './workspaceGitRunner.js';
import {
  parseRemoteList,
  pickDefaultRemote,
  remoteFromUpstreamRef
} from './workspaceGitRemote.js';
import { GitUserError } from './gitUserError.js';
import {
  ensureGitAuthorIdentity,
  gitHasCommits,
  type GitAuthorHints
} from './workspaceGitAuthor.js';

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote?: boolean;
}

export interface GitStashEntry {
  index: number;
  message: string;
}

async function hasStagedChanges(gitRun: WorkspaceGitRun): Promise<boolean> {
  try {
    const out = await gitRun(['diff', '--cached', '--name-only']);
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export async function gitStage(gitRun: WorkspaceGitRun, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await gitRun(['add', '--', ...paths]);
}

export async function gitUnstage(gitRun: WorkspaceGitRun, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  if (await gitHasCommits(gitRun)) {
    await gitRun(['restore', '--staged', '--', ...paths]);
    return;
  }
  await gitRun(['rm', '--cached', '--', ...paths]);
}

export async function gitStageAll(gitRun: WorkspaceGitRun): Promise<void> {
  await gitRun(['add', '-A']);
}

export async function gitUnstageAll(gitRun: WorkspaceGitRun): Promise<void> {
  if (!(await hasStagedChanges(gitRun))) return;
  if (await gitHasCommits(gitRun)) {
    await gitRun(['restore', '--staged', '.']);
    return;
  }
  await gitRun(['rm', '-r', '--cached', '.']);
}

export async function gitCommit(
  gitRun: WorkspaceGitRun,
  message: string,
  opts?: { amend?: boolean; stageAllIfEmpty?: boolean; authorHints?: GitAuthorHints }
): Promise<void> {
  const trimmed = message.trim();
  if (opts?.amend) {
    if (trimmed) {
      await gitRun(['commit', '--amend', '-m', trimmed]);
    } else {
      await gitRun(['commit', '--amend', '--no-edit']);
    }
    return;
  }
  if (!trimmed) throw new GitUserError('Commit message cannot be empty.');
  if (opts?.stageAllIfEmpty) {
    const staged = await hasStagedChanges(gitRun);
    if (!staged) await gitStageAll(gitRun);
  }
  await ensureGitAuthorIdentity(gitRun, opts?.authorHints);
  await gitRun(['commit', '-m', trimmed]);
}

export async function gitListRemotes(gitRun: WorkspaceGitRun): Promise<string[]> {
  try {
    const out = await gitRun(['remote']);
    return parseRemoteList(out);
  } catch {
    return [];
  }
}

export async function gitResolveSyncRemote(
  gitRun: WorkspaceGitRun,
  branch: string | null
): Promise<string | null> {
  if (branch) {
    try {
      const upstream = await gitRun([
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        `${branch}@{upstream}`
      ]);
      const tracked = remoteFromUpstreamRef(upstream);
      if (tracked) return tracked;
    } catch {
      // no upstream configured
    }
  }
  return pickDefaultRemote(await gitListRemotes(gitRun));
}

export async function gitFetch(gitRun: WorkspaceGitRun, remote = 'origin'): Promise<void> {
  await gitRun(['fetch', remote, '--prune']);
}

export async function gitPull(gitRun: WorkspaceGitRun, branch: string, remote = 'origin'): Promise<void> {
  await gitRun(['pull', '--ff-only', remote, branch]);
}

export async function gitPush(
  gitRun: WorkspaceGitRun,
  branch: string,
  remote = 'origin',
  setUpstream = false
): Promise<void> {
  if (setUpstream) {
    await gitRun(['push', '-u', remote, branch]);
  } else {
    await gitRun(['push', remote, branch]);
  }
}

export async function gitDiscard(
  gitRun: WorkspaceGitRun,
  path: string,
  status: GitPathStatus
): Promise<void> {
  if (status === '?') {
    await gitRun(['clean', '-fd', '--', path]);
    return;
  }
  await gitRun(['restore', '--staged', '--worktree', '--source=HEAD', '--', path]);
}

export async function gitDiscardAll(gitRun: WorkspaceGitRun): Promise<void> {
  await gitRun(['restore', '--staged', '--worktree', '--source=HEAD', '.']);
  await gitRun(['clean', '-fd']);
}

export async function gitStashPush(
  gitRun: WorkspaceGitRun,
  opts?: { message?: string; paths?: string[]; includeUntracked?: boolean }
): Promise<void> {
  const args = ['stash', 'push'];
  if (opts?.includeUntracked) args.push('-u');
  if (opts?.message?.trim()) args.push('-m', opts.message.trim());
  if (opts?.paths && opts.paths.length > 0) {
    args.push('--', ...opts.paths);
  }
  await gitRun(args);
}

export async function gitStashPop(gitRun: WorkspaceGitRun, index = 0): Promise<void> {
  await gitRun(['stash', 'pop', `stash@{${index}}`]);
}

export async function gitStashDrop(gitRun: WorkspaceGitRun, index: number): Promise<void> {
  await gitRun(['stash', 'drop', `stash@{${index}}`]);
}

export async function gitStashList(gitRun: WorkspaceGitRun): Promise<GitStashEntry[]> {
  let out: string;
  try {
    out = await gitRun(['stash', 'list', '--format=%gd|%s']);
  } catch {
    return [];
  }
  const rows: GitStashEntry[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [ref, ...msgParts] = line.split('|');
    const match = ref?.match(/stash@\{(\d+)\}/);
    if (!match) continue;
    rows.push({
      index: Number.parseInt(match[1]!, 10),
      message: msgParts.join('|').trim() || '(no message)'
    });
  }
  return rows;
}

export async function gitListBranches(gitRun: WorkspaceGitRun): Promise<GitBranchInfo[]> {
  let out: string;
  try {
    out = await gitRun(['branch', '--format=%(refname:short)|%(HEAD)']);
  } catch {
    return [];
  }
  const branches: GitBranchInfo[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, head] = line.split('|');
    if (!name) continue;
    branches.push({ name, current: head === '*' });
  }
  return branches;
}

export async function gitCheckoutBranch(gitRun: WorkspaceGitRun, branch: string): Promise<void> {
  const trimmed = branch.trim();
  if (!trimmed) throw new GitUserError('Branch name cannot be empty.');
  await gitRun(['checkout', trimmed]);
}

export async function gitCreateBranch(
  gitRun: WorkspaceGitRun,
  branch: string,
  checkout = true
): Promise<void> {
  const trimmed = branch.trim();
  if (!trimmed) throw new GitUserError('Branch name cannot be empty.');
  if (checkout) {
    await gitRun(['checkout', '-b', trimmed]);
  } else {
    await gitRun(['branch', trimmed]);
  }
}

export async function gitRemoteHasUpstream(
  gitRun: WorkspaceGitRun,
  branch: string,
  remote = 'origin'
): Promise<boolean> {
  try {
    await gitRun(['rev-parse', '--verify', `${remote}/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function gitCurrentBranch(gitRun: WorkspaceGitRun): Promise<string | null> {
  try {
    const out = await gitRun(['rev-parse', '--abbrev-ref', 'HEAD']);
    if (out === 'HEAD') return null;
    return out || null;
  } catch {
    return null;
  }
}

export async function resolveSyncBranchName(
  gitRun: WorkspaceGitRun,
  opts: { branch?: string; githubBranch?: string | null; defaultBranch?: string }
): Promise<string> {
  const resolved =
    opts.branch?.trim() ||
    opts.githubBranch ||
    (await gitCurrentBranch(gitRun)) ||
    opts.defaultBranch;
  if (!resolved) {
    throw new GitUserError('Cannot sync: detached HEAD with no branch. Check out a branch first.');
  }
  return resolved;
}
