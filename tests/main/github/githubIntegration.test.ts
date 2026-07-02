import { describe, expect, it } from 'vitest';
import { filterRepos, filterReposByScope, getCachedRepos, invalidateRepoCache, setCachedRepos } from '../../../src/main/github/githubRepoCache.js';
import type { GitHubRepo } from '../../../src/shared/types/github.js';
import { validatePatFormat } from '../../../src/main/github/githubApi.js';
import { resolveClonePath } from '../../../src/main/github/githubWorkspace.js';
import { workspaceGitHubSubtitle } from '../../../src/shared/github/workspaceGitHubLabel.js';

const SAMPLE_REPOS: GitHubRepo[] = [
  {
    id: 1,
    fullName: 'vyotiq/core',
    owner: 'vyotiq',
    name: 'core',
    description: 'Agent runtime',
    private: false,
    defaultBranch: 'main',
    updatedAt: '2026-01-01T00:00:00Z',
    htmlUrl: 'https://github.com/vyotiq/core'
  },
  {
    id: 2,
    fullName: 'acme/secret-app',
    owner: 'acme',
    name: 'secret-app',
    description: 'Internal tooling',
    private: true,
    defaultBranch: 'main',
    updatedAt: '2026-01-02T00:00:00Z',
    htmlUrl: 'https://github.com/acme/secret-app'
  }
];

describe('githubRepoCache', () => {
  it('filters repos by name, owner, and description', () => {
    expect(filterRepos(SAMPLE_REPOS, 'core').map((r) => r.fullName)).toEqual(['vyotiq/core']);
    expect(filterRepos(SAMPLE_REPOS, 'internal').map((r) => r.fullName)).toEqual(['acme/secret-app']);
    expect(filterRepos(SAMPLE_REPOS)).toHaveLength(2);
  });

  it('caches and invalidates per account', () => {
    invalidateRepoCache();
    expect(getCachedRepos('acct-a')).toBeNull();
    setCachedRepos('acct-a', SAMPLE_REPOS);
    expect(getCachedRepos('acct-a')).toHaveLength(2);
    invalidateRepoCache('acct-a');
    expect(getCachedRepos('acct-a')).toBeNull();
  });

  it('filters repos by user or org scope', () => {
    expect(filterReposByScope(SAMPLE_REPOS, 'user', 'vyotiq')).toHaveLength(1);
    expect(filterReposByScope(SAMPLE_REPOS, 'org', 'vyotiq', 'acme')).toHaveLength(1);
    expect(filterReposByScope(SAMPLE_REPOS, 'all', 'vyotiq')).toHaveLength(2);
  });
});

describe('validatePatFormat', () => {
  it('accepts supported GitHub token prefixes', () => {
    expect(validatePatFormat('ghp_abc')).toBe(true);
    expect(validatePatFormat('github_pat_abc')).toBe(true);
    expect(validatePatFormat('gho_abc')).toBe(true);
    expect(validatePatFormat('ghu_abc')).toBe(true);
  });

  it('rejects unknown prefixes', () => {
    expect(validatePatFormat('not-a-token')).toBe(false);
    expect(validatePatFormat('')).toBe(false);
  });
});

describe('resolveClonePath', () => {
  it('places clones under account login and host segments', () => {
    const path = resolveClonePath('octocat', 'github.com', 'vyotiq', 'vyotiq');
    expect(path.replace(/\\/g, '/')).toMatch(/repos\/octocat\/github\.com\/vyotiq\/vyotiq$/);
  });
});

describe('workspaceGitHubSubtitle', () => {
  it('formats owner/repo @ branch', () => {
    expect(
      workspaceGitHubSubtitle({
        accountId: 'a',
        host: 'github.com',
        owner: 'vyotiq',
        repo: 'vyotiq',
        branch: 'main'
      })
    ).toBe('vyotiq/vyotiq @ main');
  });
});
