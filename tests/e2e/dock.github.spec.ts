/**
 * Dock — GitHub workspace entry points (header + empty state).
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { prepareActiveComposer } from './helpers/seedComposerSession.js';

test.describe('Dock GitHub entry points', () => {
  test('header Open from GitHub opens the workspace launcher on GitHub source', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-dock-gh-header-'));
    await prepareActiveComposer(window, workspacePath);

    await window.getByRole('button', { name: 'Open from GitHub', exact: true }).click();

    const launcher = window.getByRole('search', { name: 'Open workspace' });
    await expect(launcher).toBeVisible();
    await expect(launcher.getByRole('button', { name: 'GitHub', pressed: true })).toBeVisible();
    await expect(launcher.getByText('Connect a GitHub account to browse repositories.')).toBeVisible();
  });

  test('empty dock shows From GitHub button that opens the launcher', async ({ window }) => {
    const nav = window.getByRole('navigation', { name: 'Workspace and session navigation' });
    await window.getByRole('button', { name: 'Expand navigation' }).click();
    await expect(nav.getByText('Open a workspace', { exact: true })).toBeVisible({ timeout: 15_000 });
    await nav.locator('.vx-dock-workspace-empty').getByRole('button', { name: 'From GitHub', exact: true }).click();

    const launcher = window.getByRole('search', { name: 'Open workspace' });
    await expect(launcher).toBeVisible();
    await expect(launcher.getByRole('button', { name: 'GitHub', pressed: true })).toBeVisible();
  });
});
