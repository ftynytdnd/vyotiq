/**
 * Normalize GitHub.com vs GitHub Enterprise Server API hosts.
 */

const DEFAULT_HOST = 'github.com';

export function normalizeGitHubHost(raw: string | undefined | null): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_HOST;
  try {
    const withProto = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    const url = new URL(withProto);
    return url.hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase().replace(/^https?:\/\//, '').split('/')[0] ?? DEFAULT_HOST;
  }
}

export function githubApiBase(host: string): string {
  const h = normalizeGitHubHost(host);
  // GitHub.com uses api.github.com; Enterprise Server uses https://HOST/api/v3
  if (h === DEFAULT_HOST) return 'https://api.github.com';
  return `https://${h}/api/v3`;
}

export function githubWebBase(host: string): string {
  const h = normalizeGitHubHost(host);
  return `https://${h}`;
}

export function githubCloneUrl(host: string, owner: string, repo: string): string {
  const h = normalizeGitHubHost(host);
  return `https://${h}/${owner}/${repo}.git`;
}
