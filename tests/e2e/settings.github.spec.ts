/**
 * Settings → Workspace data — GitHub accounts panel.
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { prepareActiveComposer } from './helpers/seedComposerSession.js';
import { buildDefaultGitHubE2ESeed, seedGitHubE2EFixture } from './helpers/seedGitHub.js';
import { openSettings, openWorkspaceDataSection } from './helpers/settingsNavigation.js';

test.describe('Settings GitHub panel', () => {
  test('shows empty state and token connect controls', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-github-'));
    await prepareActiveComposer(window, workspacePath);

    await openSettings(window);
    await openWorkspaceDataSection(window);

    await expect(window.getByText('No GitHub accounts connected yet.')).toBeVisible();
    await expect(window.getByRole('button', { name: 'Open from GitHub…' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Sign in with GitHub', exact: true })).toBeVisible();
    await expect(window.getByLabel('GitHub token')).toBeVisible();
    await expect(window.getByRole('button', { name: 'Connect with token' })).toBeVisible();
  });

  test('Open from GitHub opens the workspace launcher on GitHub source', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-github-'));
    await prepareActiveComposer(window, workspacePath);

    await openSettings(window);
    await openWorkspaceDataSection(window);
    await window.getByRole('button', { name: 'Open from GitHub…' }).click();

    const launcher = window.getByRole('search', { name: 'Open workspace' });
    await expect(launcher).toBeVisible();
    await expect(launcher.getByRole('button', { name: 'GitHub', pressed: true })).toBeVisible();
    await expect(launcher.getByText('Connect a GitHub account to browse repositories.')).toBeVisible();
  });

  test('seeded account shows login and re-verify control', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-github-seeded-'));
    await prepareActiveComposer(window, workspacePath);
    await seedGitHubE2EFixture(window, buildDefaultGitHubE2ESeed());

    await openSettings(window);
    await openWorkspaceDataSection(window);

    await expect(window.getByText('e2e-user')).toBeVisible();
    await expect(window.getByText(/Verified /)).toBeVisible();
    await expect(window.getByRole('button', { name: 'Re-verify e2e-user' })).toBeVisible();
    await expect(window.getByText('No GitHub accounts connected yet.')).toHaveCount(0);
  });
});
