/**
 * Settings navigation — open via shortcut, switch sections, close via dock back.
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { prepareActiveComposer } from './helpers/seedComposerSession.js';
import { closeSettings, openSettings } from './helpers/settingsNavigation.js';

test.describe('Settings navigation', () => {
  test('opens via Mod+, shortcut with settings chrome', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-nav-'));
    await prepareActiveComposer(window, workspacePath);

    await openSettings(window);

    await expect(window.getByRole('tab', { name: 'Models & API' })).toBeVisible();
    await expect(window.getByRole('tab', { name: 'Agent behavior' })).toBeVisible();
    await expect(window.getByRole('tab', { name: 'Appearance' })).toBeVisible();
  });

  test('Agent behavior section shows subsection tabs', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-nav-'));
    await prepareActiveComposer(window, workspacePath);

    await openSettings(window);
    await window.getByRole('tablist', { name: 'Settings sections' }).getByRole('tab', { name: 'Agent behavior' }).click();

    const agentNav = window.getByRole('tablist', { name: 'Agent behavior sections' });
    await expect(agentNav.getByRole('tab', { name: 'Skills' })).toBeVisible();
    await expect(agentNav.getByRole('tab', { name: 'Harness' })).toBeVisible();
  });

  test('back button returns to chat', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-nav-'));
    await prepareActiveComposer(window, workspacePath);

    await openSettings(window);
    await closeSettings(window);

    await expect(window.getByLabel(/^Message /)).toBeVisible();
  });
});
