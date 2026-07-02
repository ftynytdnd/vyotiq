import { describe, expect, it } from 'vitest';
import { GITHUB_OAUTH_CALLBACK_PLACEHOLDER } from '../../../src/shared/github/oauthConstants.js';
import { gitHubRepoSyncKey } from '../../../src/shared/github/repoSyncKey.js';

describe('gitHubRepoSyncKey', () => {
  it('joins owner and repo', () => {
    expect(gitHubRepoSyncKey('vyotiq', 'vyotiq')).toBe('vyotiq/vyotiq');
  });
});

describe('oauthConstants', () => {
  it('uses localhost placeholder for OAuth app registration', () => {
    expect(GITHUB_OAUTH_CALLBACK_PLACEHOLDER).toBe('http://localhost');
  });
});
