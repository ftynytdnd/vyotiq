/**
 * Workspace launcher row grouping and source filters.
 */

import { describe, expect, it } from 'vitest';
import type { GitHubRepo } from '@shared/types/github.js';
import type {
  GitHubRecentRow,
  GitHubRepoRow,
  LocalBrowseRow,
  LocalRecentRow,
  WorkspaceLauncherGroup
} from '@renderer/components/workspace/workspaceLauncherTypes.js';

function buildGroups(opts: {
  sourceFilter: 'all' | 'local' | 'github';
  recentPaths: string[];
  query: string;
  accountsCount: number;
  recentRepos: GitHubRecentRow[];
  repos: GitHubRepoRow[];
}): { groups: WorkspaceLauncherGroup[]; flatRows: number } {
  const groups: WorkspaceLauncherGroup[] = [];
  let flat = 0;
  const q = opts.query.trim().toLowerCase();

  const showLocal = opts.sourceFilter === 'all' || opts.sourceFilter === 'local';
  const showGitHub = opts.sourceFilter === 'all' || opts.sourceFilter === 'github';

  if (showLocal) {
    const recentLocal: LocalRecentRow[] = opts.recentPaths
      .filter((p) => !q || p.toLowerCase().includes(q))
      .map((path) => ({
        id: `local:${path}`,
        kind: 'local-recent',
        path,
        ariaLabel: path
      }));
    if (recentLocal.length > 0) {
      groups.push({ id: 'recent-local', label: 'Recent', rows: recentLocal });
      flat += recentLocal.length;
    }
    const browse: LocalBrowseRow = {
      id: 'local:browse',
      kind: 'local-browse',
      ariaLabel: 'Browse folder'
    };
    groups.push({ id: 'local', label: 'Local', rows: [browse] });
    flat += 1;
  }

  if (showGitHub && opts.accountsCount > 0) {
    if (opts.recentRepos.length > 0) {
      groups.push({ id: 'recent-github', label: 'Recent', rows: opts.recentRepos });
      flat += opts.recentRepos.length;
    }
    if (opts.repos.length > 0) {
      groups.push({ id: 'github', label: 'GitHub', rows: opts.repos });
      flat += opts.repos.length;
    }
  }

  return { groups, flatRows: flat };
}

describe('workspace launcher row model', () => {
  const sampleRepo: GitHubRepo = {
    id: 1,
    fullName: 'acme/app',
    owner: 'acme',
    name: 'app',
    description: 'Demo',
    private: false,
    defaultBranch: 'main',
    updatedAt: '',
    htmlUrl: ''
  };

  it('hides GitHub groups when source filter is local', () => {
    const recentGh: GitHubRecentRow = {
      id: 'gh-recent:acme/app',
      kind: 'github-recent',
      recent: { owner: 'acme', repo: 'app', branch: 'main' },
      repo: sampleRepo,
      ariaLabel: 'acme/app @ main'
    };
    const repoRow: GitHubRepoRow = {
      id: 'gh-repo:acme/app',
      kind: 'github-repo',
      repo: sampleRepo,
      description: 'Demo',
      ariaLabel: 'acme/app Demo'
    };

    const { groups } = buildGroups({
      sourceFilter: 'local',
      recentPaths: ['/tmp/ws'],
      query: '',
      accountsCount: 1,
      recentRepos: [recentGh],
      repos: [repoRow]
    });

    expect(groups.some((g) => g.id === 'github' || g.id === 'recent-github')).toBe(false);
    expect(groups.some((g) => g.id === 'local')).toBe(true);
  });

  it('filters local recents by query', () => {
    const { groups, flatRows } = buildGroups({
      sourceFilter: 'all',
      recentPaths: ['/tmp/alpha', '/tmp/beta'],
      query: 'beta',
      accountsCount: 0,
      recentRepos: [],
      repos: []
    });

    const recent = groups.find((g) => g.id === 'recent-local');
    expect(recent?.rows).toHaveLength(1);
    expect(recent?.rows[0]?.kind).toBe('local-recent');
    if (recent?.rows[0]?.kind === 'local-recent') {
      expect(recent.rows[0].path).toBe('/tmp/beta');
    }
    expect(flatRows).toBe(2);
  });

  it('uses compact connect row on all source when no accounts', () => {
    const connectRow = {
      id: 'connect:expand',
      kind: 'github-connect' as const,
      ariaLabel: 'Connect GitHub account'
    };
    const groups: WorkspaceLauncherGroup[] = [
      { id: 'local', label: 'Local', rows: [{ id: 'local:browse', kind: 'local-browse', ariaLabel: 'Browse folder' }] },
      { id: 'connect', label: 'Connect', rows: [connectRow] }
    ];
    const connect = groups.find((g) => g.id === 'connect');
    expect(connect?.rows[0]?.kind).toBe('github-connect');
  });
});
