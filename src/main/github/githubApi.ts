/**
 * GitHub REST API client (raw fetch — no SDK).
 */

import type { GitHubBranch, GitHubOrg, GitHubRepo } from '@shared/types/github.js';
import { githubApiBase } from '@shared/github/githubHosts.js';
import { logger } from '../logging/logger.js';

const log = logger.child('github/api');

const USER_AGENT = 'Vyotiq-Desktop';

export interface GitHubApiUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

interface GitHubApiRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  default_branch: string;
  updated_at: string;
  html_url: string;
}

interface GitHubApiBranch {
  name: string;
  protected: boolean;
  commit: { sha: string };
}

interface GitHubApiOrg {
  login: string;
  avatar_url: string | null;
}

async function githubFetch<T>(
  host: string,
  token: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const base = githubApiBase(host);
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.warn('github api error', { path, status: res.status, body: body.slice(0, 200) });
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 120) || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function fetchGitHubUser(host: string, token: string): Promise<GitHubApiUser> {
  return githubFetch<GitHubApiUser>(host, token, '/user');
}

function mapRepo(row: GitHubApiRepo): GitHubRepo {
  return {
    id: row.id,
    fullName: row.full_name,
    owner: row.owner.login,
    name: row.name,
    description: row.description,
    private: row.private,
    defaultBranch: row.default_branch,
    updatedAt: row.updated_at,
    htmlUrl: row.html_url
  };
}

async function fetchRepoPage(
  host: string,
  token: string,
  url: string
): Promise<{ repos: GitHubRepo[]; next: string | null }> {
  const base = githubApiBase(host);
  const fullUrl = url.startsWith('http') ? url : `${base}${url}`;
  const res = await fetch(fullUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 120) || res.statusText}`);
  }
  const rows = (await res.json()) as GitHubApiRepo[];
  const link = res.headers.get('link');
  let next: string | null = null;
  if (link) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    next = match?.[1] ?? null;
  }
  return { repos: rows.map(mapRepo), next };
}

/** Personal repos + org repos the token can see (paginated, capped). */
export async function listAllGitHubRepos(
  host: string,
  token: string,
  opts?: { maxPages?: number }
): Promise<GitHubRepo[]> {
  const maxPages = opts?.maxPages ?? 20;
  const out: GitHubRepo[] = [];
  const seen = new Set<number>();
  let url: string | null = '/user/repos?per_page=100&sort=updated&affiliation=owner,organization_member';
  let pages = 0;
  while (url && pages < maxPages) {
    const page = await fetchRepoPage(host, token, url);
    for (const repo of page.repos) {
      if (seen.has(repo.id)) continue;
      seen.add(repo.id);
      out.push(repo);
    }
    url = page.next;
    pages += 1;
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** Organizations the authenticated user belongs to. */
export async function listGitHubOrgs(
  host: string,
  token: string,
  opts?: { maxPages?: number }
): Promise<GitHubOrg[]> {
  const maxPages = opts?.maxPages ?? 10;
  const out: GitHubOrg[] = [];
  const seen = new Set<string>();
  let page = 1;
  while (page <= maxPages) {
    const rows = await githubFetch<GitHubApiOrg[]>(
      host,
      token,
      `/user/orgs?per_page=100&page=${page}`
    );
    for (const row of rows) {
      if (seen.has(row.login)) continue;
      seen.add(row.login);
      out.push({ login: row.login, avatarUrl: row.avatar_url });
    }
    if (rows.length < 100) break;
    page += 1;
  }
  out.sort((a, b) => a.login.localeCompare(b.login));
  return out;
}

export async function listGitHubBranches(
  host: string,
  token: string,
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  const rows: GitHubBranch[] = [];
  let page = 1;
  const perPage = 100;
  for (;;) {
    const batch = await githubFetch<GitHubApiBranch[]>(
      host,
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=${perPage}&page=${page}`
    );
    for (const row of batch) {
      rows.push({
        name: row.name,
        protected: row.protected,
        sha: row.commit.sha
      });
    }
    if (batch.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }
  return rows;
}

export async function fetchDefaultBranch(
  host: string,
  token: string,
  owner: string,
  repo: string
): Promise<string> {
  const meta = await githubFetch<{ default_branch: string }>(
    host,
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  );
  return meta.default_branch;
}

export function validatePatFormat(token: string): boolean {
  const t = token.trim();
  return (
    t.startsWith('ghp_') ||
    t.startsWith('github_pat_') ||
    t.startsWith('gho_') ||
    t.startsWith('ghu_')
  );
}

