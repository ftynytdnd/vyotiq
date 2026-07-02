/**
 * In-memory repo list cache per GitHub account.
 */

import type { GitHubRepo, GitHubRepoScope } from '@shared/types/github.js';

interface CacheEntry {
  repos: GitHubRepo[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(accountId: string): string {
  return accountId;
}

export function getCachedRepos(accountId: string): GitHubRepo[] | null {
  const entry = cache.get(cacheKey(accountId));
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
  return entry.repos;
}

export function setCachedRepos(accountId: string, repos: GitHubRepo[]): void {
  cache.set(cacheKey(accountId), { repos, fetchedAt: Date.now() });
}

export function invalidateRepoCache(accountId?: string): void {
  if (accountId) cache.delete(cacheKey(accountId));
  else cache.clear();
}

export function filterRepos(repos: GitHubRepo[], query?: string): GitHubRepo[] {
  const q = query?.trim().toLowerCase();
  if (!q) return repos;
  return repos.filter(
    (r) =>
      r.fullName.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      (r.description?.toLowerCase().includes(q) ?? false)
  );
}

export function filterReposByScope(
  repos: GitHubRepo[],
  scope: GitHubRepoScope | undefined,
  accountLogin: string,
  orgLogin?: string
): GitHubRepo[] {
  if (!scope || scope === 'all') return repos;
  if (scope === 'user') return repos.filter((r) => r.owner === accountLogin);
  if (scope === 'org' && orgLogin) return repos.filter((r) => r.owner === orgLogin);
  return repos;
}
