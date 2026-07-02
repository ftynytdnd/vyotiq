/**

 * Workspace launcher — GitHub scope pills and recent repos.

 */



import { mkdtemp } from 'node:fs/promises';

import os from 'node:os';

import path from 'node:path';

import { test, expect } from './fixtures/electron.fixture.js';

import { prepareActiveComposer } from './helpers/seedComposerSession.js';

import { buildDefaultGitHubE2ESeed, seedGitHubE2EFixture } from './helpers/seedGitHub.js';

import { seedPartialGitHubClone, seedReadyGitHubClone } from './helpers/seedGitHubClone.js';

import { openSettings, openWorkspaceDataSection } from './helpers/settingsNavigation.js';



async function openGitHubWorkspaceLauncher(window: import('@playwright/test').Page) {

  await openSettings(window);

  await openWorkspaceDataSection(window);

  await window.getByRole('button', { name: 'From GitHub…', exact: true }).click();

  const launcher = window.getByRole('search', { name: 'Open workspace' });

  await expect(launcher).toBeVisible();

  return launcher;

}



test.describe('Workspace launcher — GitHub', () => {

  test('scope pills filter repositories by user and org', async ({ window }) => {

    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-gh-scope-'));

    await prepareActiveComposer(window, workspacePath);

    await seedGitHubE2EFixture(window, buildDefaultGitHubE2ESeed());



    const launcher = await openGitHubWorkspaceLauncher(window);

    const scope = launcher.getByRole('group', { name: 'Repository scope' });



    await expect(scope.getByRole('button', { name: 'All' })).toBeVisible();

    await expect(scope.getByRole('button', { name: '@e2e-user' })).toBeVisible();

    await expect(scope.getByRole('button', { name: 'acme' })).toBeVisible();



    await expect(launcher.getByRole('option', { name: 'e2e-user/core Personal repo' })).toBeVisible();

    await expect(launcher.getByRole('option', { name: 'acme/internal Org repo' })).toBeVisible();



    await scope.getByRole('button', { name: '@e2e-user' }).click();

    await expect(launcher.getByRole('option', { name: 'e2e-user/core Personal repo' })).toBeVisible();

    await expect(launcher.getByRole('option', { name: 'acme/internal Org repo' })).toHaveCount(0);



    await scope.getByRole('button', { name: 'acme' }).click();

    await expect(launcher.getByRole('option', { name: 'acme/internal Org repo' })).toBeVisible();

    await expect(launcher.getByRole('option', { name: 'e2e-user/core Personal repo' })).toHaveCount(0);



    await scope.getByRole('button', { name: 'All' }).click();

    await expect(launcher.getByRole('option', { name: 'e2e-user/core Personal repo' })).toBeVisible();

    await expect(launcher.getByRole('option', { name: 'acme/internal Org repo' })).toBeVisible();

  });



  test('shows recent repos for the active account', async ({ window }) => {

    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-gh-recent-'));

    await prepareActiveComposer(window, workspacePath);

    await seedGitHubE2EFixture(window, buildDefaultGitHubE2ESeed());



    const launcher = await openGitHubWorkspaceLauncher(window);



    await expect(launcher.getByText('Recent')).toBeVisible();

    await expect(launcher.getByRole('option', { name: 'e2e-user/core @ main' })).toBeVisible();

  });



  test('selecting a repo with partial clone shows retry banner', async ({ window, userDataDir }) => {

    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-gh-partial-'));

    await prepareActiveComposer(window, workspacePath);

    await seedGitHubE2EFixture(window, buildDefaultGitHubE2ESeed());

    await seedPartialGitHubClone(userDataDir, 'e2e-user', 'e2e-user', 'core');



    const launcher = await openGitHubWorkspaceLauncher(window);

    await launcher.getByRole('option', { name: 'e2e-user/core Personal repo' }).click();



    await expect(launcher.getByText('Incomplete local clone — retry to remove and re-clone.')).toBeVisible();

    await expect(launcher.getByRole('button', { name: 'Retry clone' })).toBeVisible();

  });



  test('recent repo opens workspace without network when clone exists', async ({ window, userDataDir }) => {

    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-gh-recent-open-'));

    await prepareActiveComposer(window, workspacePath);

    await seedGitHubE2EFixture(window, buildDefaultGitHubE2ESeed());

    await seedReadyGitHubClone(userDataDir, 'e2e-user', 'e2e-user', 'core');



    const launcher = await openGitHubWorkspaceLauncher(window);

    await launcher.getByRole('option', { name: 'e2e-user/core @ main' }).click();

    await launcher.getByRole('button', { name: 'Open repository' }).click();



    await expect(launcher).toHaveCount(0, { timeout: 20_000 });

    await expect(window.getByText('e2e-user/core')).toBeVisible();

  });



  test('offers token connect when browser sign-in is unavailable', async ({ window }) => {

    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-gh-oauth-guard-'));

    await prepareActiveComposer(window, workspacePath);



    await openSettings(window);

    await openWorkspaceDataSection(window);

    await window.getByRole('button', { name: 'From GitHub…', exact: true }).click();



    const launcher = window.getByRole('search', { name: 'Open workspace' });

    await expect(launcher.getByLabel('GitHub token')).toBeVisible();

    await expect(launcher.getByRole('button', { name: 'Connect with token' })).toBeVisible();

    await expect(launcher.getByRole('button', { name: 'Sign in with GitHub', exact: true })).toHaveCount(0);

  });

});

