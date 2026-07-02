/**
 * Dock scheduled runs surfacing — toolbar popover and settings deep link.
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import {
  prepareLandingComposer,
  seedScheduledRun
} from './helpers/seedComposerSession.js';

test.describe('Dock scheduled runs', () => {
  test('lists enabled schedules and opens Settings manage link', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-schedules-'));
    const session = await prepareLandingComposer(window, workspacePath);
    const provider = await window.evaluate(async () => {
      const providers = await window.vyotiq.providers.list();
      const p = providers.find((row) => row.name === 'E2E Provider');
      if (!p || !p.models?.[0]) throw new Error('E2E provider missing');
      return { providerId: p.id, modelId: p.models[0]!.id };
    });
    await seedScheduledRun(window, {
      workspaceId: session.workspaceId,
      conversationId: session.conversationId,
      providerId: provider.providerId,
      modelId: provider.modelId,
      label: 'Hourly CI sweep'
    });
    await window.reload();
    await window.waitForLoadState('domcontentloaded');

    await window.getByRole('button', { name: 'Scheduled runs' }).click();

    const region = window.getByRole('region', { name: 'Scheduled runs' });
    await expect(region).toBeVisible();
    await expect(region.getByText('Hourly CI sweep')).toBeVisible();

    await region.getByRole('button', { name: 'Manage…' }).click();
    await expect(window.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(window.locator('.vx-settings-subpanel-title')).toHaveText('Scheduled runs');
  });
});
