/**
 * GitHub account + repository types for multi-account workspace onboarding.
 */

export type GitHubAuthKind = 'oauth' | 'pat';

/** Public metadata for a connected GitHub identity (no tokens). */
export interface GitHubAccount {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  /** API host — `github.com` or a GitHub Enterprise Server hostname. */
  host: string;
  authKind: GitHubAuthKind;
  addedAt: number;
  /** Last successful API contact (profile or repo list). */
  lastVerifiedAt?: number;
  /** Set when the last verify or API call failed (e.g. expired token). */
  verifyStatus?: 'ok' | 'error';
  lastVerifyError?: string;
}

export type GitHubGitProgressKind = 'clone' | 'fetch' | 'checkout' | 'pull';

/** Main → renderer push while git clone/fetch runs. */
export interface GitHubGitProgress {
  workspaceId?: string;
  owner: string;
  repo: string;
  branch?: string;
  kind: GitHubGitProgressKind;
  /** Last stderr line from git, when available. */
  line?: string;
  done?: boolean;
}

export interface GitHubRepo {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface GitHubOrg {
  login: string;
  avatarUrl: string | null;
}

export type GitHubRepoScope = 'all' | 'user' | 'org';

export type GitHubCloneState = 'absent' | 'ready' | 'partial';

export interface GitHubCloneStateResult {
  state: GitHubCloneState;
  path: string;
}

export interface GitHubRecentRepo {
  owner: string;
  repo: string;
  branch: string;
  openedAt: number;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
  sha: string;
}

/** E2E fixture payload (`github:__e2e-seed`, NODE_ENV=test only). */
export interface GitHubE2ESeedInput {
  account: {
    login: string;
    host?: string;
  };
  repos: GitHubRepo[];
  orgs?: GitHubOrg[];
  recent?: GitHubRecentRepo[];
  /** Keyed by `owner/repo` — returned from `listBranches` in NODE_ENV=test. */
  branches?: Record<string, GitHubBranch[]>;
}

/** E2E-only — attach GitHub metadata to an existing workspace row. */
export interface GitHubE2EBindWorkspaceInput {
  workspaceId: string;
  accountId: string;
  owner: string;
  repo: string;
  branch: string;
  host?: string;
}

/** Persisted on {@link WorkspaceEntry} when opened from GitHub. */
export interface WorkspaceGitHubBinding {
  accountId: string;
  host: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface GitHubDeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type GitHubDeviceFlowPoll =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'success'; account: GitHubAccount };

export interface GitHubAddPatInput {
  host: string;
  token: string;
  label?: string;
}

export interface GitHubOpenRepoInput {
  accountId: string;
  owner: string;
  repo: string;
  branch?: string;
  /** Remove an incomplete local clone before cloning again. */
  recoverPartial?: boolean;
}

export interface GitHubSwitchBranchInput {
  workspaceId: string;
  branch: string;
}

export interface GitHubListReposInput {
  accountId: string;
  refresh?: boolean;
  query?: string;
  scope?: GitHubRepoScope;
  orgLogin?: string;
}
