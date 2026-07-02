import type { GitHubAccount } from '../types/github.js';

/** Accounts older than this should prompt re-verify in Settings. */
export const GITHUB_ACCOUNT_STALE_MS = 30 * 24 * 60 * 60 * 1000;

export function isGitHubAccountStale(account: GitHubAccount): boolean {
  if (account.verifyStatus === 'error') return true;
  if (!account.lastVerifiedAt) return true;
  return Date.now() - account.lastVerifiedAt > GITHUB_ACCOUNT_STALE_MS;
}

export function formatGitHubVerifiedAt(ts?: number): string {
  if (ts == null) return 'Never verified';
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}
