/**
 * Resolve the GitHub OAuth App client ID for Device Flow.
 *
 * Priority: Settings override → env → bundled Vyotiq app ID.
 * End users should only need the bundled ID; overrides are for GHE / dev.
 */

import { BUNDLED_GITHUB_OAUTH_CLIENT_ID } from './oauthConstants.js';

export interface GitHubOAuthClientIdSources {
  /** Settings → Workspace → advanced OAuth client ID override. */
  settingsClientId?: string | null;
  /** `VYOTIQ_GITHUB_OAUTH_CLIENT_ID` at runtime (main process). */
  envClientId?: string | null;
  /** Shipped Vyotiq OAuth App client ID (public). */
  bundledClientId?: string | null;
  /** When true, skip bundled fallback (E2E / isolated test profiles). */
  disableBundled?: boolean;
}

export function resolveGitHubOAuthClientId(sources: GitHubOAuthClientIdSources): string | null {
  const fromSettings = sources.settingsClientId?.trim();
  if (fromSettings) return fromSettings;
  const fromEnv = sources.envClientId?.trim();
  if (fromEnv) return fromEnv;
  if (!sources.disableBundled) {
    const bundled = (sources.bundledClientId ?? BUNDLED_GITHUB_OAUTH_CLIENT_ID).trim();
    if (bundled) return bundled;
  }
  return null;
}

/** Main-process resolution from persisted settings + runtime env. */
export function resolveGitHubOAuthClientIdFromRuntime(
  settingsClientId?: string | null
): string | null {
  return resolveGitHubOAuthClientId({
    settingsClientId,
    envClientId: process.env.VYOTIQ_GITHUB_OAUTH_CLIENT_ID,
    disableBundled: process.env.VYOTIQ_DISABLE_BUNDLED_GITHUB_OAUTH === '1'
  });
}
