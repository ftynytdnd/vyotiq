import { beforeEach, describe, expect, it, vi } from 'vitest';

let persisted: unknown[] | null = null;

const readEncryptedJson = vi.fn(async () => persisted);
const writeEncryptedJson = vi.fn(async (_file: string, data: unknown) => {
  persisted = data as unknown[];
});

vi.mock('@main/secrets/safeStore.js', () => ({
  readEncryptedJson: (...args: unknown[]) => readEncryptedJson(...args),
  writeEncryptedJson: (...args: unknown[]) => writeEncryptedJson(...args)
}));

vi.mock('@main/github/githubApi.js', () => ({
  fetchGitHubUser: vi.fn()
}));

describe('githubAccountsStore', () => {
  beforeEach(async () => {
    persisted = null;
    readEncryptedJson.mockClear();
    writeEncryptedJson.mockClear();
    vi.resetModules();
  });

  it('upsertGitHubAccount redacts token from list output', async () => {
    const { upsertGitHubAccount, listGitHubAccounts } = await import(
      '@main/github/githubAccountsStore.js'
    );
    const row = await upsertGitHubAccount({
      login: 'octo',
      name: 'Octo',
      avatarUrl: null,
      host: 'github.com',
      authKind: 'pat',
      token: 'secret-token'
    });
    expect(row.login).toBe('octo');
    expect(row).not.toHaveProperty('token');
    const listed = await listGitHubAccounts();
    expect(listed[0]?.login).toBe('octo');
    expect(listed[0]).not.toHaveProperty('token');
  });
});
