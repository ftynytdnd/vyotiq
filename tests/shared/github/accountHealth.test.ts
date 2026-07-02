import { describe, expect, it } from 'vitest';
import {
  formatGitHubVerifiedAt,
  isGitHubAccountStale,
  GITHUB_ACCOUNT_STALE_MS
} from '../../../src/shared/github/accountHealth.js';
import { formatGitProgressMessage } from '../../../src/shared/github/formatGitProgressMessage.js';
import type { GitHubAccount } from '../../../src/shared/types/github.js';

const baseAccount: GitHubAccount = {
  id: 'a',
  login: 'octocat',
  name: null,
  avatarUrl: null,
  host: 'github.com',
  authKind: 'pat',
  addedAt: 0
};

describe('accountHealth', () => {
  it('marks error status and missing verify time as stale', () => {
    expect(isGitHubAccountStale({ ...baseAccount, verifyStatus: 'error' })).toBe(true);
    expect(isGitHubAccountStale(baseAccount)).toBe(true);
  });

  it('marks old verification as stale', () => {
    const old = Date.now() - GITHUB_ACCOUNT_STALE_MS - 1;
    expect(isGitHubAccountStale({ ...baseAccount, lastVerifiedAt: old, verifyStatus: 'ok' })).toBe(
      true
    );
    expect(
      isGitHubAccountStale({ ...baseAccount, lastVerifiedAt: Date.now(), verifyStatus: 'ok' })
    ).toBe(false);
  });

  it('formats verified timestamp', () => {
    expect(formatGitHubVerifiedAt(undefined)).toBe('Never verified');
    expect(formatGitHubVerifiedAt(0)).toContain('1970');
  });
});

describe('formatGitProgressMessage', () => {
  it('includes repo and stderr hint for clone', () => {
    const msg = formatGitProgressMessage({
      owner: 'vyotiq',
      repo: 'vyotiq',
      branch: 'main',
      kind: 'clone',
      line: 'Receiving objects: 42%'
    });
    expect(msg).toContain('vyotiq/vyotiq');
    expect(msg).toContain('Receiving objects');
  });
});
