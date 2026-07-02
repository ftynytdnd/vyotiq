/**
 * GitHub OAuth Device Flow — browser authorization without redirect URIs.
 */

import { shell } from 'electron';
import type { GitHubDeviceFlowPoll, GitHubDeviceFlowStart } from '@shared/types/github.js';
import { normalizeGitHubHost, githubWebBase } from '@shared/github/githubHosts.js';
import { resolveGitHubOAuthClientIdFromRuntime } from '@shared/github/resolveOAuthClientId.js';
import { readBlob } from '../settings/blob.js';
import { upsertGitHubAccount } from './githubAccountsStore.js';
import { fetchGitHubUser } from './githubApi.js';
import { logger } from '../logging/logger.js';

const log = logger.child('github/oauth');

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function resolveClientId(): Promise<string> {
  const blob = await readBlob();
  const clientId = resolveGitHubOAuthClientIdFromRuntime(blob.ui?.githubOAuthClientId);
  if (!clientId) {
    throw new Error(
      'GitHub browser sign-in is not available in this build. Connect with a personal access token instead.'
    );
  }
  return clientId;
}

function deviceEndpoints(host: string): { deviceCode: string; accessToken: string } {
  const base = githubWebBase(host);
  return {
    deviceCode: `${base}/login/device/code`,
    accessToken: `${base}/login/oauth/access_token`
  };
}

const DEFAULT_SCOPES = ['read:user', 'repo', 'read:org'];

export async function startGitHubDeviceFlow(hostInput?: string): Promise<GitHubDeviceFlowStart> {
  const host = normalizeGitHubHost(hostInput);
  const clientId = await resolveClientId();
  const { deviceCode: deviceCodeUrl } = deviceEndpoints(host);
  const res = await fetch(deviceCodeUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: DEFAULT_SCOPES.join(' ')
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub device code request failed (${res.status}): ${body.slice(0, 120)}`);
  }
  const data = (await res.json()) as DeviceCodeResponse;
  const verificationUri = data.verification_uri.includes('?')
    ? data.verification_uri
    : `${data.verification_uri}?user_code=${encodeURIComponent(data.user_code)}`;
  void shell.openExternal(verificationUri);
  log.info('started github device flow', { host, expiresIn: data.expires_in });
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri,
    expiresIn: data.expires_in,
    interval: data.interval
  };
}

export async function pollGitHubDeviceFlow(
  deviceCode: string,
  hostInput?: string
): Promise<GitHubDeviceFlowPoll> {
  const host = normalizeGitHubHost(hostInput);
  const clientId = await resolveClientId();
  const { accessToken: accessTokenUrl } = deviceEndpoints(host);
  const res = await fetch(accessTokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  });
  const data = (await res.json()) as TokenResponse;
  if (data.error === 'authorization_pending') return { status: 'pending' };
  if (data.error === 'slow_down') return { status: 'slow_down' };
  if (data.error === 'expired_token') return { status: 'expired' };
  if (data.error === 'access_denied') return { status: 'denied' };
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? 'GitHub OAuth failed');
  }
  const user = await fetchGitHubUser(host, data.access_token);
  const account = await upsertGitHubAccount({
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    host,
    authKind: 'oauth',
    token: data.access_token
  });
  log.info('github device flow succeeded', { login: user.login, host });
  return { status: 'success', account };
}
