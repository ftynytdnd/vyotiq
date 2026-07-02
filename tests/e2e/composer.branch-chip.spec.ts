/**
 * Composer branch chip — GitHub binding + ahead/behind sync suffix.
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { prepareActiveComposer, waitForComposerSession } from './helpers/seedComposerSession.js';
import {
  bindGitHubWorkspace,
  buildDefaultGitHubE2ESeed,
  seedGitHubE2EFixture
} from './helpers/seedGitHub.js';
import { stubWorkspaceGitStatus } from './helpers/stubWorkspaceGitStatus.js';

test.describe('Composer branch chip', () => {
  test('shows ahead and behind sync suffix for GitHub workspaces', async ({ window, electronApp }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-branch-chip-'));
    const session = await prepareActiveComposer(window, workspacePath);
    const { accountId } = await seedGitHubE2EFixture(window, buildDefaultGitHubE2ESeed());

    await bindGitHubWorkspace(window, {
      workspaceId: session.workspaceId,
      accountId,
      owner: 'e2e-user',
      repo: 'core',
      branch: 'main'
    });

    await stubWorkspaceGitStatus(electronApp, {
      isRepo: true,
      branch: 'main',
      headShort: 'abc1234',
      dirtyCount: 0,
      ahead: 2,
      behind: 1
    });

    await window.reload();
    await window.waitForLoadState('domcontentloaded');
    await waitForComposerSession(window);

    const chip = window.getByRole('button', { name: 'Branch main. Click to switch.' });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await expect(chip).toContainText('main ↑2 ↓1');
  });
});
