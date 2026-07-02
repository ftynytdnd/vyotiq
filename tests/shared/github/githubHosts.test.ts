import { describe, expect, it } from 'vitest';
import {
  expectedRemoteUrl,
  normalizeRemoteUrl
} from '../../../src/main/github/gitRunner.js';
import {
  githubApiBase,
  githubCloneUrl,
  normalizeGitHubHost
} from '../../../src/shared/github/githubHosts.js';
import { resolveGitHubOAuthClientId } from '../../../src/shared/github/resolveOAuthClientId.js';

describe('githubHosts', () => {
  it('normalizes hosts', () => {
    expect(normalizeGitHubHost('')).toBe('github.com');
    expect(normalizeGitHubHost('https://GitHub.Enterprise.COM/')).toBe('github.enterprise.com');
    expect(githubApiBase('github.com')).toBe('https://api.github.com');
    expect(githubApiBase('github.enterprise.com')).toBe('https://github.enterprise.com/api/v3');
    expect(githubCloneUrl('github.com', 'vyotiq', 'vyotiq')).toBe(
      'https://github.com/vyotiq/vyotiq.git'
    );
  });
});

describe('gitRunner remote normalization', () => {
  it('matches ssh and https remotes', () => {
    const https = 'https://github.com/vyotiq/vyotiq.git';
    const ssh = 'git@github.com:vyotiq/vyotiq.git';
    expect(normalizeRemoteUrl(https)).toBe(normalizeRemoteUrl(ssh));
    expect(expectedRemoteUrl('github.com', 'vyotiq', 'vyotiq')).toBe(normalizeRemoteUrl(https));
  });
});

describe('resolveGitHubOAuthClientId', () => {
  it('prefers settings over env and bundled', () => {
    expect(
      resolveGitHubOAuthClientId({
        settingsClientId: 'from-settings',
        envClientId: 'from-env',
        bundledClientId: 'from-bundled'
      })
    ).toBe('from-settings');
  });

  it('falls back to bundled when settings and env are empty', () => {
    expect(
      resolveGitHubOAuthClientId({
        settingsClientId: '',
        envClientId: '',
        bundledClientId: 'from-bundled'
      })
    ).toBe('from-bundled');
  });

  it('skips bundled when disableBundled is set', () => {
    expect(
      resolveGitHubOAuthClientId({
        bundledClientId: 'from-bundled',
        disableBundled: true
      })
    ).toBeNull();
  });
});
