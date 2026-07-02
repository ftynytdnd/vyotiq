import { describe, expect, it } from 'vitest';
import { GITHUB_RECENT_REPOS_MAX } from '../../../src/main/github/githubRecentRepos.js';

describe('githubRecentRepos', () => {
  it('caps recent repos per account', () => {
    expect(GITHUB_RECENT_REPOS_MAX).toBe(5);
  });
});
