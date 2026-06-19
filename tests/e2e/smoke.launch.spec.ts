/**
 * Vyotiq Electron launch smoke — real main + preload + renderer via Playwright.
 *
 * Assertions:
 *   - App boots against `out/` (unfused dev Electron binary)
 *   - Preload IPC bridge is live (`window.vyotiq`)
 *   - Shell chrome renders (title bar, landing or composer)
 */

import { test, expect } from './fixtures/electron.fixture.js';

test.describe('Vyotiq launch smoke', () => {
  test('main window opens with IPC bridge and shell chrome', async ({ electronApp, window }) => {
    await expect(window).toHaveTitle('Vyotiq — Agent V');
    await expect(window.locator('#root')).not.toBeEmpty();
    await expect(window.getByText('Open a workspace to begin')).toBeVisible();
    await expect(window.getByLabel('Menu')).toBeVisible();

    const isPackaged = await electronApp.evaluate(async ({ app }) => app.isPackaged);
    expect(isPackaged).toBe(false);

    const userDataPath = await electronApp.evaluate(async ({ app }) => app.getPath('userData'));
    expect(userDataPath).toContain('vyotiq-e2e-');

    const info = await window.evaluate(() => window.vyotiq.app.info());
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(info.electron).toBeTruthy();
    expect(info.userDataDir).toContain('vyotiq');

    await expect(window.getByText('Open a workspace to begin')).toBeVisible();
    await expect(window.getByLabel('Message Agent V')).toBeVisible();
  });

  test('settings IPC responds on a fresh profile', async ({ window }) => {
    const settings = await window.evaluate(() => window.vyotiq.settings.get());
    expect(settings).toBeTruthy();
    expect(typeof settings.ui).toBe('object');
  });

  test('workspace list IPC responds on a fresh profile', async ({ window }) => {
    const state = await window.evaluate(() => window.vyotiq.workspace.list());
    expect(state).toBeTruthy();
    expect(Array.isArray(state.workspaces)).toBe(true);
  });
});
