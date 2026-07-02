/**
 * Seed GitHub catalogue fixtures for E2E (requires NODE_ENV=test main handler).
 */

import type { Page } from '@playwright/test';
import type { GitHubE2EBindWorkspaceInput, GitHubE2ESeedInput } from '../../../src/shared/types/github.js';

export async function seedGitHubE2EFixture(
  window: Page,
  input: GitHubE2ESeedInput
): Promise<{ accountId: string }> {
  return window.evaluate(async (seed) => window.vyotiq.github.e2eSeed(seed), input);
}

export async function bindGitHubWorkspace(
  window: Page,
  input: GitHubE2EBindWorkspaceInput
): Promise<void> {
  await window.evaluate(async (bind) => {
    await window.vyotiq.github.e2eBindWorkspace(bind);
  }, input);
}

export const E2E_GITHUB_SAMPLE_BRANCHES = {
  'e2e-user/core': [{ name: 'main', protected: false, sha: 'e2e0001' }],
  'acme/internal': [{ name: 'main', protected: true, sha: 'e2e0002' }]
} as const;

export const E2E_GITHUB_SAMPLE_REPOS = [
  {
    id: 101,
    fullName: 'e2e-user/core',
    owner: 'e2e-user',
    name: 'core',
    description: 'Personal repo',
    private: false,
    defaultBranch: 'main',
    updatedAt: '2026-06-01T00:00:00Z',
    htmlUrl: 'https://github.com/e2e-user/core'
  },
  {
    id: 102,
    fullName: 'acme/internal',
    owner: 'acme',
    name: 'internal',
    description: 'Org repo',
    private: true,
    defaultBranch: 'main',
    updatedAt: '2026-06-02T00:00:00Z',
    htmlUrl: 'https://github.com/acme/internal'
  }
] as const;

export function buildDefaultGitHubE2ESeed(
  overrides: Partial<GitHubE2ESeedInput> = {}
): GitHubE2ESeedInput {
  return {
    account: { login: 'e2e-user', host: 'github.com' },
    repos: [...E2E_GITHUB_SAMPLE_REPOS],
    orgs: [{ login: 'acme', avatarUrl: null }],
    recent: [
      {
        owner: 'e2e-user',
        repo: 'core',
        branch: 'main',
        openedAt: Date.now()
      }
    ],
    branches: { ...E2E_GITHUB_SAMPLE_BRANCHES },
    ...overrides
  };
}
