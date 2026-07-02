import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const readBlob = vi.fn(async () => ({ ui: { githubOAuthClientId: 'test-client-id' } }));
const upsertGitHubAccount = vi.fn(async () => ({ id: 'acc-1', login: 'octo' }));
const fetchGitHubUser = vi.fn(async () => ({
  login: 'octo',
  name: 'Octo',
  avatar_url: 'https://example.com/a.png'
}));

vi.stubGlobal('fetch', fetchMock);

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() }
}));

vi.mock('@main/settings/blob.js', () => ({
  readBlob: (...args: unknown[]) => readBlob(...args)
}));

vi.mock('@main/github/githubAccountsStore.js', () => ({
  upsertGitHubAccount: (...args: unknown[]) => upsertGitHubAccount(...args)
}));

vi.mock('@main/github/githubApi.js', () => ({
  fetchGitHubUser: (...args: unknown[]) => fetchGitHubUser(...args)
}));

describe('githubDeviceOAuth', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    upsertGitHubAccount.mockClear();
  });

  it('startGitHubDeviceFlow returns device code payload', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: 'dc',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })
    });
    const { startGitHubDeviceFlow } = await import('@main/github/githubDeviceOAuth.js');
    const start = await startGitHubDeviceFlow();
    expect(start.deviceCode).toBe('dc');
    expect(start.userCode).toBe('ABCD-1234');
    expect(start.interval).toBe(5);
  });

  it('pollGitHubDeviceFlow maps authorization_pending', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: 'authorization_pending' })
    });
    const { pollGitHubDeviceFlow } = await import('@main/github/githubDeviceOAuth.js');
    const result = await pollGitHubDeviceFlow('dc');
    expect(result.status).toBe('pending');
  });
});
