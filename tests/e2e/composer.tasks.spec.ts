/**
 * Composer task tray — hydrates from tasks IPC and expands to show rows.
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import {
  prepareActiveComposer,
  waitForComposerSession
} from './helpers/seedComposerSession.js';
import { getActiveConversationId } from './helpers/settingsNavigation.js';

const TASK_ITEMS = [
  { id: '1', content: 'Ship feature', status: 'pending' as const },
  { id: '2', content: 'Write tests', status: 'in_progress' as const }
];

test.describe('Composer task tray', () => {
  test('hydrates from tasks IPC and shows progress summary', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-tasks-'));
    await prepareActiveComposer(window, workspacePath);

    const conversationId = await getActiveConversationId(window);
    await window.evaluate(
      async ({ convId, items }) => window.vyotiq.tasks.set(convId, items),
      { convId: conversationId, items: TASK_ITEMS }
    );

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await waitForComposerSession(window);
    await expect(window.getByText('Loading conversation…')).toHaveCount(0, { timeout: 15_000 });

    const tray = window.getByRole('region', { name: 'Task list' });
    await expect(tray).toBeVisible({ timeout: 15_000 });
    await expect(tray).toContainText('0/2 done');
  });

  test('expanding the tray shows task rows', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-tasks-'));
    await prepareActiveComposer(window, workspacePath);

    const conversationId = await getActiveConversationId(window);
    await window.evaluate(
      async ({ convId, items }) => window.vyotiq.tasks.set(convId, items),
      { convId: conversationId, items: TASK_ITEMS }
    );

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await waitForComposerSession(window);
    await expect(window.getByText('Loading conversation…')).toHaveCount(0, { timeout: 15_000 });

    const tray = window.getByRole('region', { name: 'Task list' });
    await expect(tray).toBeVisible({ timeout: 15_000 });
    await tray.getByRole('button', { name: /Tasks/i }).click();

    await expect(window.getByText('Ship feature')).toBeVisible();
    await expect(window.getByText('Write tests')).toBeVisible();
  });
});
