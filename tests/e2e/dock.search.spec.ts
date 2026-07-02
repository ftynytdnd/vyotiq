/**
 * Mod+K unified dock search — skills group and placeholder.
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { prepareLandingComposer } from './helpers/seedComposerSession.js';

test.describe('Dock unified search', () => {
  test('opens with Mod+K and lists bundled skills', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-search-'));
    await prepareLandingComposer(window, workspacePath);

    await window.keyboard.press('Control+K');

    const searchRegion = window.getByRole('search', { name: 'Search workspace' });
    await expect(searchRegion).toBeVisible();
    const input = searchRegion.locator('input');
    await expect(input).toBeVisible();

    await input.fill('review');
    await expect(searchRegion.getByText('Skills')).toBeVisible();
    await expect(searchRegion.getByText('/review')).toBeVisible();
  });

  test('titlebar search button opens the same popover', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-search-btn-'));
    await prepareLandingComposer(window, workspacePath);

    const collapseNav = window.getByRole('button', { name: 'Collapse navigation' });
    if (await collapseNav.isVisible()) {
      await collapseNav.click();
    }

    await window
      .getByRole('button', { name: /Search skills, chats, messages, and files/i })
      .click();

    const searchRegion = window.getByRole('search', { name: 'Search workspace' });
    await expect(searchRegion.locator('input')).toBeVisible();
  });
});
