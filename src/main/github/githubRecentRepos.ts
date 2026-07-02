/**
 * Persist recently opened GitHub repos per account (settings.ui).
 */

import type { GitHubRecentRepo } from '@shared/types/github.js';
import { readBlob, updateBlob } from '../settings/blob.js';

export const GITHUB_RECENT_REPOS_MAX = 5;

export async function listRecentGitHubRepos(accountId: string): Promise<GitHubRecentRepo[]> {
  const blob = await readBlob();
  const map = blob.ui?.recentGitHubReposByAccount ?? {};
  return map[accountId] ?? [];
}

export async function recordRecentGitHubRepo(
  accountId: string,
  entry: Pick<GitHubRecentRepo, 'owner' | 'repo' | 'branch'>
): Promise<void> {
  const openedAt = Date.now();
  await updateBlob((current) => {
    const ui = { ...(current.ui ?? {}) };
    const map = { ...(ui.recentGitHubReposByAccount ?? {}) };
    const prev = map[accountId] ?? [];
    const next: GitHubRecentRepo[] = [
      { ...entry, openedAt },
      ...prev.filter((r) => !(r.owner === entry.owner && r.repo === entry.repo))
    ].slice(0, GITHUB_RECENT_REPOS_MAX);
    map[accountId] = next;
    return { ...current, ui: { ...ui, recentGitHubReposByAccount: map } };
  });
}
