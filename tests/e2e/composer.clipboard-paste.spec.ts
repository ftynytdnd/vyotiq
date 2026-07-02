/**
 * Composer clipboard image paste — renderer paste handler + stubbed
 * `attachments:ingest-clipboard` IPC (no OS clipboard required).
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import {
  pasteClipboardImage,
  readIngestClipboardCalls,
  seedComposerSession,
  stubIngestClipboardImage,
  waitForComposerSession
} from './helpers/seedComposerSession.js';

test.describe('Composer clipboard paste', () => {
  test('paste ingests clipboard image via stubbed attachments IPC', async ({ window, electronApp }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-ws-'));
    await seedComposerSession(window, workspacePath);

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await waitForComposerSession(window);
    await expect(window.getByLabel(/^Message /)).toBeVisible();
    await expect(window.getByText('Loading conversation…')).toHaveCount(0, { timeout: 15_000 });
    await window.getByRole('button', { name: 'New chat' }).click();
    await expect(window.locator('[data-e2e-can-attach="true"]')).toBeVisible({ timeout: 15_000 });

    await stubIngestClipboardImage(window, electronApp);
    await pasteClipboardImage(window);

    await expect
      .poll(async () => (await readIngestClipboardCalls(window)).length, { timeout: 10_000 })
      .toBe(1);

    await expect(window.getByLabel('Remove clipboard-e2e.png')).toBeVisible();

    const calls = await readIngestClipboardCalls(window);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      workspaceId: expect.any(String),
      conversationId: expect.any(String),
      messageId: expect.any(String)
    });
  });
});
