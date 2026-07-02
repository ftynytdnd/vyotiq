/**
 * In-memory GitHub catalogue fixtures for E2E (NODE_ENV=test only).
 */

import type {
  GitHubBranch,
  GitHubE2EBindWorkspaceInput,
  GitHubE2ESeedInput,
  GitHubOrg
} from '@shared/types/github.js';
import { upsertGitHubAccount } from './githubAccountsStore.js';
import { setCachedRepos } from './githubRepoCache.js';
import { updateBlob } from '../settings/blob.js';
import { updateWorkspaceGitHubBinding } from '../workspace/workspaceState.js';

export const E2E_GITHUB_TEST_TOKEN = 'ghp_e2etest000000000000000000000000';

export function isE2ETestGitHubToken(token: string): boolean {
  return token.startsWith('ghp_e2etest');
}

const e2eOrgsByAccount = new Map<string, GitHubOrg[]>();
const e2eBranchesByAccount = new Map<string, Record<string, GitHubBranch[]>>();

function repoKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

export async function seedGitHubE2EFixture(input: GitHubE2ESeedInput): Promise<{ accountId: string }> {
  const account = await upsertGitHubAccount({
    login: input.account.login,
    name: null,
    avatarUrl: null,
    host: input.account.host ?? 'github.com',
    authKind: 'pat',
    token: E2E_GITHUB_TEST_TOKEN
  });
  setCachedRepos(account.id, input.repos);
  e2eOrgsByAccount.set(account.id, input.orgs ?? []);
  e2eBranchesByAccount.set(account.id, input.branches ?? {});
  if (input.recent?.length) {
    await updateBlob((current) => {
      const ui = { ...(current.ui ?? {}) };
      const map = { ...(ui.recentGitHubReposByAccount ?? {}) };
      map[account.id] = input.recent!;
      return { ...current, ui: { ...ui, recentGitHubReposByAccount: map } };
    });
  }
  return { accountId: account.id };
}

export function getGitHubE2EOrgs(accountId: string): GitHubOrg[] | null {
  if (!e2eOrgsByAccount.has(accountId)) return null;
  return e2eOrgsByAccount.get(accountId) ?? [];
}

export function getGitHubE2EBranches(
  accountId: string,
  owner: string,
  repo: string
): GitHubBranch[] | null {
  const map = e2eBranchesByAccount.get(accountId);
  if (!map) return null;
  return map[repoKey(owner, repo)] ?? [{ name: 'main', protected: false, sha: 'e2e0000' }];
}

export async function e2eBindWorkspaceGitHub(input: GitHubE2EBindWorkspaceInput) {
  return updateWorkspaceGitHubBinding(input.workspaceId, {
    accountId: input.accountId,
    host: input.host ?? 'github.com',
    owner: input.owner,
    repo: input.repo,
    branch: input.branch
  });
}

