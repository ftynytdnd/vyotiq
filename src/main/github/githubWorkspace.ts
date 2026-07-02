/**
 * Open or clone a GitHub repo as a Vyotiq workspace.
 */

import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import type { WorkspaceEntry } from '@shared/types/ipc.js';
import type { GitHubCloneState, GitHubOpenRepoInput } from '@shared/types/github.js';
import { normalizeGitHubHost } from '@shared/github/githubHosts.js';
import { vyotiqDataDir } from '../paths/userDataLayout.js';
import { getGitHubAccountWithToken } from './githubAccountsStore.js';
import { fetchDefaultBranch } from './githubApi.js';
import {
  cloneRepo,
  detectGitCloneState,
  expectedRemoteUrl,
  fetchAndCheckout,
  gitRemoteOriginUrl,
  normalizeRemoteUrl,
  pathExists,
  removePartialClone
} from './gitRunner.js';
import { emitGitHubGitDone, gitProgressContext } from './githubGitProgress.js';
import { emitWorkspaceTreeChanged } from '../workspace/workspaceTreeWatcher.js';
import {
  addWorkspace,
  findWorkspaceByPath,
  renameWorkspace,
  updateWorkspaceGitHubBinding
} from '../workspace/workspaceState.js';
import { logger } from '../logging/logger.js';
import { recordRecentGitHubRepo } from './githubRecentRepos.js';
import { isE2ETestGitHubToken } from './githubE2eFixtures.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const log = logger.child('github/workspace');

async function ensureE2ELocalGitRepo(repoPath: string): Promise<void> {
  const state = await detectGitCloneState(repoPath);
  if (state === 'ready') return;
  if (state === 'partial') await removePartialClone(repoPath);
  await fs.mkdir(repoPath, { recursive: true });
  await execFileAsync('git', ['init'], { cwd: repoPath });
}

function reposRoot(): string {
  return join(vyotiqDataDir(), 'repos');
}

export function resolveClonePath(
  accountLogin: string,
  host: string,
  owner: string,
  repo: string
): string {
  const h = normalizeGitHubHost(host);
  const hostSegment = h === 'github.com' ? 'github.com' : h;
  return join(reposRoot(), accountLogin, hostSegment, owner, repo);
}

async function findExistingClonePath(
  accountLogin: string,
  host: string,
  owner: string,
  repo: string
): Promise<string | null> {
  const canonical = resolveClonePath(accountLogin, host, owner, repo);
  if (await pathExists(canonical)) {
    const remote = await gitRemoteOriginUrl(canonical);
    if (remote && normalizeRemoteUrl(remote) === expectedRemoteUrl(host, owner, repo)) {
      return canonical;
    }
  }
  const accountRoot = join(reposRoot(), accountLogin);
  if (!(await pathExists(accountRoot))) return null;
  const expected = expectedRemoteUrl(host, owner, repo);
  const stack: string[] = [accountRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const gitDir = entries.find((e) => e.isDirectory() && e.name === '.git');
    if (gitDir) {
      const remote = await gitRemoteOriginUrl(dir);
      if (remote && normalizeRemoteUrl(remote) === expected) return dir;
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        stack.push(join(dir, entry.name));
      }
    }
  }
  return null;
}

export async function getGitHubCloneState(
  accountId: string,
  owner: string,
  repo: string
): Promise<{ state: GitHubCloneState; path: string }> {
  const account = await getGitHubAccountWithToken(accountId);
  if (!account) throw new Error('GitHub account not found');
  const host = normalizeGitHubHost(account.host);
  const path = resolveClonePath(account.login, host, owner, repo);
  const state = await detectGitCloneState(path);
  return { state, path };
}

export async function openGitHubRepoAsWorkspace(input: GitHubOpenRepoInput): Promise<WorkspaceEntry> {
  const account = await getGitHubAccountWithToken(input.accountId);
  if (!account) throw new Error('GitHub account not found');
  const host = normalizeGitHubHost(account.host);
  const e2eLocal = process.env.NODE_ENV === 'test' && isE2ETestGitHubToken(account.token);
  const branch =
    input.branch?.trim() ||
    (e2eLocal ? 'main' : await fetchDefaultBranch(host, account.token, input.owner, input.repo));

  let clonePath = await findExistingClonePath(account.login, host, input.owner, input.repo);
  if (clonePath && (await detectGitCloneState(clonePath)) === 'partial') {
    await removePartialClone(clonePath);
    clonePath = null;
  }
  const progressBase = { owner: input.owner, repo: input.repo, branch };
  if (!clonePath) {
    clonePath = resolveClonePath(account.login, host, input.owner, input.repo);
    const cloneState = await detectGitCloneState(clonePath);
    if (cloneState === 'partial' || input.recoverPartial) {
      await removePartialClone(clonePath);
    }
    if (!(await pathExists(clonePath))) {
      const progress = gitProgressContext(progressBase);
      try {
        if (e2eLocal) {
          await ensureE2ELocalGitRepo(clonePath);
        } else {
          await cloneRepo({
            host,
            owner: input.owner,
            repo: input.repo,
            branch,
            destPath: clonePath,
            token: account.token,
            progress
          });
        }
      } finally {
        emitGitHubGitDone({ ...progressBase, kind: 'clone' });
      }
    }
  } else {
    const existing = findWorkspaceByPath(clonePath);
    const progress = gitProgressContext({
      ...progressBase,
      workspaceId: existing?.id
    });
    try {
      if (!e2eLocal) {
        await fetchAndCheckout(clonePath, branch, account.token, host, progress);
      }
    } finally {
      emitGitHubGitDone({ ...progressBase, workspaceId: existing?.id, kind: 'fetch' });
      if (existing?.id) emitWorkspaceTreeChanged(existing.id);
    }
  }

  const label = `${input.owner}/${input.repo}`;
  const existing = findWorkspaceByPath(clonePath);
  if (existing) {
    const entry = await updateWorkspaceGitHubBinding(existing.id, {
      accountId: account.id,
      host,
      owner: input.owner,
      repo: input.repo,
      branch
    });
    await recordRecentGitHubRepo(account.id, {
      owner: input.owner,
      repo: input.repo,
      branch
    });
    log.info('reactivated github workspace', { id: entry.id, path: clonePath });
    return entry;
  }

  const added = await addWorkspace(clonePath);
  let entry = await updateWorkspaceGitHubBinding(added.id, {
    accountId: account.id,
    host,
    owner: input.owner,
    repo: input.repo,
    branch
  });
  entry = await renameWorkspace(entry.id, label);
  await recordRecentGitHubRepo(account.id, {
    owner: input.owner,
    repo: input.repo,
    branch
  });
  log.info('opened github workspace', { id: entry.id, path: clonePath, branch });
  return entry;
}
