/**
 * Unified workspace launcher — local folder and GitHub repos.
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { prepareActiveComposer } from './helpers/seedComposerSession.js';
import { openSettings, openWorkspaceDataSection } from './helpers/settingsNavigation.js';

test.describe('Workspace launcher', () => {
  test('settings Add workspace opens elevated launcher with local source', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-open-ws-local-'));
    await prepareActiveComposer(window, workspacePath);

    await openSettings(window);
    await openWorkspaceDataSection(window);
    await window.getByRole('button', { name: 'Add workspace…' }).click();

    const launcher = window.getByRole('search', { name: 'Open workspace' });
    await expect(launcher).toBeVisible();
    await expect(launcher.getByRole('button', { name: 'Local', pressed: true })).toBeVisible();
    await expect(launcher.getByPlaceholder('Search folders and repositories…')).toBeVisible();
    await expect(launcher.getByRole('option', { name: 'Browse folder' })).toBeVisible();
  });
});
