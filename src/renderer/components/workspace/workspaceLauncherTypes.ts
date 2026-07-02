/**
 * Row and group types for the workspace launcher palette.
 */

import type { GitHubRecentRepo, GitHubRepo } from '@shared/types/github.js';

export type RepoScopeFilter =
  | { kind: 'all' }
  | { kind: 'user' }
  | { kind: 'org'; login: string };

export type WorkspaceLauncherRowKind =
  | 'local-recent'
  | 'local-browse'
  | 'local-path-submit'
  | 'github-recent'
  | 'github-repo'
  | 'github-connect'
  | 'github-connect-sign-in'
  | 'github-connect-token';

export interface WorkspaceLauncherRowBase {
  id: string;
  kind: WorkspaceLauncherRowKind;
  ariaLabel: string;
}

export interface LocalRecentRow extends WorkspaceLauncherRowBase {
  kind: 'local-recent';
  path: string;
}

export interface LocalBrowseRow extends WorkspaceLauncherRowBase {
  kind: 'local-browse';
}

export interface LocalPathSubmitRow extends WorkspaceLauncherRowBase {
  kind: 'local-path-submit';
  path: string;
}

export interface GitHubRecentRow extends WorkspaceLauncherRowBase {
  kind: 'github-recent';
  recent: GitHubRecentRepo;
  repo: GitHubRepo;
}

export interface GitHubRepoRow extends WorkspaceLauncherRowBase {
  kind: 'github-repo';
  repo: GitHubRepo;
  description: string | null;
}

export interface GitHubConnectRow extends WorkspaceLauncherRowBase {
  kind: 'github-connect';
}

export interface GitHubConnectSignInRow extends WorkspaceLauncherRowBase {
  kind: 'github-connect-sign-in';
}

export interface GitHubConnectTokenRow extends WorkspaceLauncherRowBase {
  kind: 'github-connect-token';
}

export type WorkspaceLauncherRow =
  | LocalRecentRow
  | LocalBrowseRow
  | LocalPathSubmitRow
  | GitHubRecentRow
  | GitHubRepoRow
  | GitHubConnectRow
  | GitHubConnectSignInRow
  | GitHubConnectTokenRow;

export interface WorkspaceLauncherGroup {
  id: string;
  label: string;
  rows: WorkspaceLauncherRow[];
}
