/**
 * Encrypted GitHub account store — tokens never reach the renderer.
 */

import { randomUUID } from 'node:crypto';
import type { GitHubAccount, GitHubAuthKind } from '@shared/types/github.js';
import { GITHUB_ACCOUNTS_FILE } from '@shared/constants.js';
import { normalizeGitHubHost } from '@shared/github/githubHosts.js';
import { readEncryptedJson, writeEncryptedJson } from '../secrets/safeStore.js';
import { fetchGitHubUser } from './githubApi.js';
import { logger } from '../logging/logger.js';

const log = logger.child('github/accounts');

interface PersistedGitHubAccount {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  host: string;
  authKind: GitHubAuthKind;
  token: string;
  addedAt: number;
  lastVerifiedAt?: number;
  verifyStatus?: 'ok' | 'error';
  lastVerifyError?: string;
}

let cache: PersistedGitHubAccount[] | null = null;

async function load(): Promise<PersistedGitHubAccount[]> {
  if (cache) return cache;
  cache = (await readEncryptedJson<PersistedGitHubAccount[]>(GITHUB_ACCOUNTS_FILE)) ?? [];
  return cache;
}

async function persistCandidate(list: PersistedGitHubAccount[]): Promise<void> {
  await writeEncryptedJson(GITHUB_ACCOUNTS_FILE, list);
}

function redact(row: PersistedGitHubAccount): GitHubAccount {
  const { token: _token, ...safe } = row;
  void _token;
  return safe;
}

export async function listGitHubAccounts(): Promise<GitHubAccount[]> {
  const list = await load();
  return list.map(redact);
}

export async function getGitHubAccountWithToken(id: string): Promise<PersistedGitHubAccount | null> {
  const list = await load();
  const found = list.find((a) => a.id === id);
  return found ? { ...found } : null;
}

export async function upsertGitHubAccount(input: {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  host: string;
  authKind: GitHubAuthKind;
  token: string;
}): Promise<GitHubAccount> {
  const list = await load();
  const host = normalizeGitHubHost(input.host);
  const existing = list.find((a) => normalizeGitHubHost(a.host) === host && a.login === input.login);
  const now = Date.now();
  if (existing) {
    const updated: PersistedGitHubAccount = {
      ...existing,
      name: input.name,
      avatarUrl: input.avatarUrl,
      token: input.token,
      authKind: input.authKind,
      lastVerifiedAt: now,
      verifyStatus: 'ok',
      lastVerifyError: undefined
    };
    const candidate = list.map((a) => (a.id === existing.id ? updated : a));
    await persistCandidate(candidate);
    cache = candidate;
    log.info('refreshed github account token', { id: existing.id, login: input.login, host });
    return redact(updated);
  }
  const row: PersistedGitHubAccount = {
    id: randomUUID(),
    login: input.login,
    name: input.name,
    avatarUrl: input.avatarUrl,
    host,
    authKind: input.authKind,
    token: input.token,
    addedAt: now,
    lastVerifiedAt: now,
    verifyStatus: 'ok'
  };
  const candidate = [row, ...list];
  await persistCandidate(candidate);
  cache = candidate;
  log.info('added github account', { id: row.id, login: row.login, host });
  return redact(row);
}

export async function removeGitHubAccount(id: string): Promise<boolean> {
  const list = await load();
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  await persistCandidate(next);
  cache = next;
  log.info('removed github account', { id });
  return true;
}

export async function verifyGitHubAccount(id: string): Promise<GitHubAccount> {
  const list = await load();
  const row = list.find((a) => a.id === id);
  if (!row) throw new Error('GitHub account not found');
  try {
    const user = await fetchGitHubUser(row.host, row.token);
    const updated: PersistedGitHubAccount = {
      ...row,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url,
      lastVerifiedAt: Date.now(),
      verifyStatus: 'ok',
      lastVerifyError: undefined
    };
    const candidate = list.map((a) => (a.id === id ? updated : a));
    await persistCandidate(candidate);
    cache = candidate;
    log.info('verified github account', { id, login: user.login });
    return redact(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const updated: PersistedGitHubAccount = {
      ...row,
      verifyStatus: 'error',
      lastVerifyError: msg
    };
    const candidate = list.map((a) => (a.id === id ? updated : a));
    await persistCandidate(candidate);
    cache = candidate;
    log.warn('github account verify failed', { id, err: msg });
    throw new Error(msg);
  }
}

export async function touchGitHubAccountVerified(id: string): Promise<void> {
  const list = await load();
  const row = list.find((a) => a.id === id);
  if (!row) return;
  const updated: PersistedGitHubAccount = {
    ...row,
    lastVerifiedAt: Date.now(),
    verifyStatus: 'ok',
    lastVerifyError: undefined
  };
  const candidate = list.map((a) => (a.id === id ? updated : a));
  await persistCandidate(candidate);
  cache = candidate;
}

export async function markGitHubAccountVerifyError(id: string, message: string): Promise<void> {
  const list = await load();
  const row = list.find((a) => a.id === id);
  if (!row) return;
  const updated: PersistedGitHubAccount = {
    ...row,
    verifyStatus: 'error',
    lastVerifyError: message
  };
  const candidate = list.map((a) => (a.id === id ? updated : a));
  await persistCandidate(candidate);
  cache = candidate;
}

