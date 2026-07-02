/**
 * GitHub IPC — accounts, repo catalogue, clone/open workspace.
 */

import { IPC } from '@shared/constants.js';
import type {
  GitHubAddPatInput,
  GitHubDeviceFlowPoll,
  GitHubE2EBindWorkspaceInput,
  GitHubE2ESeedInput,
  GitHubListReposInput,
  GitHubOpenRepoInput,
  GitHubSwitchBranchInput
} from '@shared/types/github.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertString,
  assertObject,
  assertOptionalString,
  assertBoolean
} from './validate.js';
import {
  listGitHubAccounts,
  removeGitHubAccount,
  upsertGitHubAccount,
  getGitHubAccountWithToken,
  verifyGitHubAccount,
  touchGitHubAccountVerified,
  markGitHubAccountVerifyError
} from '../github/githubAccountsStore.js';
import { startGitHubDeviceFlow, pollGitHubDeviceFlow } from '../github/githubDeviceOAuth.js';
import { listAllGitHubRepos, listGitHubBranches, listGitHubOrgs, validatePatFormat, fetchGitHubUser } from '../github/githubApi.js';
import { filterRepos, filterReposByScope, getCachedRepos, setCachedRepos, invalidateRepoCache } from '../github/githubRepoCache.js';
import { openGitHubRepoAsWorkspace, getGitHubCloneState } from '../github/githubWorkspace.js';
import { listRecentGitHubRepos } from '../github/githubRecentRepos.js';
import {
  getGitHubE2EOrgs,
  getGitHubE2EBranches,
  e2eBindWorkspaceGitHub,
  seedGitHubE2EFixture,
} from '../github/githubE2eFixtures.js';
import { isGitHubOAuthConfigured } from '../github/githubOAuthStatus.js';
import { switchWorkspaceBranch } from '../workspace/workspaceState.js';
import { normalizeGitHubHost } from '@shared/github/githubHosts.js';
import { logger } from '../logging/logger.js';

const log = logger.child('ipc/github');

export function registerGitHubIpc(): void {
  wrapIpcHandler(IPC.GITHUB_ACCOUNTS_LIST, async () => listGitHubAccounts());

  wrapIpcHandler(IPC.GITHUB_ACCOUNTS_START_DEVICE, async (_event, host?: string) => {
    assertOptionalString('github:start-device', 'host', host, { maxBytes: 256 });
    return startGitHubDeviceFlow(host);
  });

  wrapIpcHandler(
    IPC.GITHUB_ACCOUNTS_POLL_DEVICE,
    async (_event, deviceCode: string, host?: string): Promise<GitHubDeviceFlowPoll> => {
      assertString('github:poll-device', 'deviceCode', deviceCode, { maxBytes: 512 });
      assertOptionalString('github:poll-device', 'host', host, { maxBytes: 256 });
      return pollGitHubDeviceFlow(deviceCode, host);
    }
  );

  wrapIpcHandler(IPC.GITHUB_ACCOUNTS_ADD_PAT, async (_event, input: GitHubAddPatInput) => {
    assertObject('github:add-pat', 'input', input);
    assertString('github:add-pat', 'input.host', input.host, { maxBytes: 256 });
    assertString('github:add-pat', 'input.token', input.token, { maxBytes: 4096 });
    const token = input.token.trim();
    if (!validatePatFormat(token)) {
      throw new Error('Token must start with ghp_, github_pat_, gho_, or ghu_.');
    }
    const host = normalizeGitHubHost(input.host);
    const user = await fetchGitHubUser(host, token);
    return upsertGitHubAccount({
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
      host,
      authKind: 'pat',
      token
    });
  });

  wrapIpcHandler(IPC.GITHUB_ACCOUNTS_REMOVE, async (_event, id: string) => {
    assertString('github:remove-account', 'id', id);
    invalidateRepoCache(id);
    const ok = await removeGitHubAccount(id);
    return { ok };
  });

  wrapIpcHandler(IPC.GITHUB_ACCOUNTS_VERIFY, async (_event, id: string) => {
    assertString('github:verify-account', 'id', id);
    return verifyGitHubAccount(id);
  });

  wrapIpcHandler(IPC.GITHUB_OAUTH_CONFIGURED, async () => isGitHubOAuthConfigured());

  wrapIpcHandler(IPC.GITHUB_REPOS_LIST, async (_event, input: GitHubListReposInput) => {
    assertObject('github:repos-list', 'input', input);
    assertString('github:repos-list', 'input.accountId', input.accountId);
    if (input.refresh !== undefined) assertBoolean('github:repos-list', 'input.refresh', input.refresh);
    assertOptionalString('github:repos-list', 'input.query', input.query, { maxBytes: 256 });
    assertOptionalString('github:repos-list', 'input.orgLogin', input.orgLogin, { maxBytes: 256 });
    const account = await getGitHubAccountWithToken(input.accountId);
    if (!account) throw new Error('GitHub account not found');
    let repos = !input.refresh ? getCachedRepos(input.accountId) : null;
    try {
      if (!repos) {
        repos = await listAllGitHubRepos(account.host, account.token);
        setCachedRepos(input.accountId, repos);
      }
      await touchGitHubAccountVerified(input.accountId);
      const scoped = filterReposByScope(repos, input.scope, account.login, input.orgLogin);
      return filterRepos(scoped, input.query);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|bad credentials|token/i.test(msg)) {
        await markGitHubAccountVerifyError(input.accountId, msg);
      }
      throw err;
    }
  });

  wrapIpcHandler(IPC.GITHUB_ORGS_LIST, async (_event, accountId: string) => {
    assertString('github:orgs-list', 'accountId', accountId);
    const fixtureOrgs = process.env.NODE_ENV === 'test' ? getGitHubE2EOrgs(accountId) : null;
    if (fixtureOrgs) return fixtureOrgs;
    const account = await getGitHubAccountWithToken(accountId);
    if (!account) throw new Error('GitHub account not found');
    return listGitHubOrgs(account.host, account.token);
  });

  wrapIpcHandler(IPC.GITHUB_REPOS_RECENT, async (_event, accountId: string) => {
    assertString('github:repos-recent', 'accountId', accountId);
    return listRecentGitHubRepos(accountId);
  });

  wrapIpcHandler(
    IPC.GITHUB_REPOS_CLONE_STATE,
    async (_event, accountId: string, owner: string, repo: string) => {
      assertString('github:repos-clone-state', 'accountId', accountId);
      assertString('github:repos-clone-state', 'owner', owner, { maxBytes: 256 });
      assertString('github:repos-clone-state', 'repo', repo, { maxBytes: 256 });
      return getGitHubCloneState(accountId, owner, repo);
    }
  );

  wrapIpcHandler(
    IPC.GITHUB_REPOS_BRANCHES,
    async (_event, accountId: string, owner: string, repo: string) => {
      assertString('github:repos-branches', 'accountId', accountId);
      assertString('github:repos-branches', 'owner', owner, { maxBytes: 256 });
      assertString('github:repos-branches', 'repo', repo, { maxBytes: 256 });
      const account = await getGitHubAccountWithToken(accountId);
      if (!account) throw new Error('GitHub account not found');
      const fixtureBranches =
        process.env.NODE_ENV === 'test' ? getGitHubE2EBranches(accountId, owner, repo) : null;
      if (fixtureBranches) return fixtureBranches;
      return listGitHubBranches(account.host, account.token, owner, repo);
    }
  );

  wrapIpcHandler(IPC.GITHUB_REPOS_OPEN, async (_event, input: GitHubOpenRepoInput) => {
    assertObject('github:repos-open', 'input', input);
    assertString('github:repos-open', 'input.accountId', input.accountId);
    assertString('github:repos-open', 'input.owner', input.owner, { maxBytes: 256 });
    assertString('github:repos-open', 'input.repo', input.repo, { maxBytes: 256 });
    assertOptionalString('github:repos-open', 'input.branch', input.branch, { maxBytes: 256 });
    if (input.recoverPartial !== undefined) {
      assertBoolean('github:repos-open', 'input.recoverPartial', input.recoverPartial);
    }
    try {
      return await openGitHubRepoAsWorkspace(input);
    } catch (err) {
      log.warn('open github repo failed', { err, owner: input.owner, repo: input.repo });
      throw err;
    }
  });

  wrapIpcHandler(IPC.WORKSPACES_SWITCH_BRANCH, async (_event, input: GitHubSwitchBranchInput) => {
    assertObject('workspaces:switch-branch', 'input', input);
    assertString('workspaces:switch-branch', 'input.workspaceId', input.workspaceId);
    assertString('workspaces:switch-branch', 'input.branch', input.branch, { maxBytes: 256 });
    return switchWorkspaceBranch(input.workspaceId, input.branch);
  });

  if (process.env.NODE_ENV === 'test') {
    wrapIpcHandler(IPC.GITHUB_E2E_SEED, async (_event, input: GitHubE2ESeedInput) => {
      assertObject('github:e2e-seed', 'input', input);
      assertObject('github:e2e-seed', 'input.account', input.account);
      assertString('github:e2e-seed', 'input.account.login', input.account.login, { maxBytes: 256 });
      return seedGitHubE2EFixture(input);
    });

    wrapIpcHandler(IPC.GITHUB_E2E_BIND_WORKSPACE, async (_event, input: GitHubE2EBindWorkspaceInput) => {
      assertObject('github:e2e-bind-workspace', 'input', input);
      assertString('github:e2e-bind-workspace', 'input.workspaceId', input.workspaceId);
      assertString('github:e2e-bind-workspace', 'input.accountId', input.accountId);
      assertString('github:e2e-bind-workspace', 'input.owner', input.owner, { maxBytes: 256 });
      assertString('github:e2e-bind-workspace', 'input.repo', input.repo, { maxBytes: 256 });
      assertString('github:e2e-bind-workspace', 'input.branch', input.branch, { maxBytes: 256 });
      return e2eBindWorkspaceGitHub(input);
    });
  }
}
