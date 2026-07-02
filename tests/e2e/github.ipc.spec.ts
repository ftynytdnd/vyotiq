/**
 * GitHub IPC — accounts list and PAT validation through the real preload bridge.
 */

import { test, expect } from './fixtures/electron.fixture.js';
import { seedComposerSession } from './helpers/seedComposerSession.js';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test.describe('GitHub IPC', () => {
  test('github.listAccounts returns an array on a fresh profile', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-github-ipc-'));
    await seedComposerSession(window, workspacePath);

    const accounts = await window.evaluate(async () => window.vyotiq.github.listAccounts());
    expect(Array.isArray(accounts)).toBe(true);
  });

  test('github.isOAuthConfigured is false on a fresh profile', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-github-oauth-'));
    await seedComposerSession(window, workspacePath);

    const configured = await window.evaluate(async () => window.vyotiq.github.isOAuthConfigured());
    expect(configured).toBe(false);
  });

  test('github.addPat rejects invalid token format', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-github-ipc-'));
    await seedComposerSession(window, workspacePath);

    const err = await window.evaluate(async () => {
      try {
        await window.vyotiq.github.addPat({ host: 'github.com', token: 'not-a-token' });
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });

    expect(err).toMatch(/ghp_|github_pat_|gho_|ghu_/);
  });
});
