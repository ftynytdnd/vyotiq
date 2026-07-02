/**
 * GitHub REST client — pagination and error mapping.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { listAllGitHubRepos } from '@main/github/githubApi';

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) }
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('listAllGitHubRepos', () => {
  it('follows Link pagination until maxPages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('page=2')) {
        return jsonResponse(200, [
          {
            id: 2,
            full_name: 'acme/b',
            name: 'b',
            owner: { login: 'acme' },
            private: false,
            default_branch: 'main',
            updated_at: '2026-01-02T00:00:00Z',
            html_url: 'https://github.com/acme/b',
            description: null
          }
        ]);
      }
      return jsonResponse(
        200,
        [
          {
            id: 1,
            full_name: 'acme/a',
            name: 'a',
            owner: { login: 'acme' },
            private: false,
            default_branch: 'main',
            updated_at: '2026-01-01T00:00:00Z',
            html_url: 'https://github.com/acme/a',
            description: null
          }
        ],
        { link: '<https://api.github.com/user/repos?page=2>; rel="next"' }
      );
    });

    try {
      const repos = await listAllGitHubRepos('github.com', 'ghp_test', { maxPages: 2 });
      expect(repos.map((r) => r.fullName)).toEqual(['acme/b', 'acme/a']);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('throws with GitHub status on HTTP error', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(401, { message: 'Bad credentials' })
    );

    try {
      await expect(listAllGitHubRepos('github.com', 'bad', { maxPages: 1 })).rejects.toThrow(
        /GitHub API 401/
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
