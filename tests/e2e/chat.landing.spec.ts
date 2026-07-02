/**
 * Empty-chat landing — git context line above centered composer.
 */

import { execSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { prepareLandingComposer } from './helpers/seedComposerSession.js';
import { stubWorkspaceGitStatus } from './helpers/stubWorkspaceGitStatus.js';

test.describe('Chat landing discoverability', () => {
  test('shows ready-state git context above centered composer', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-landing-'));
    execSync('git init', { cwd: workspacePath, stdio: 'ignore' });

    await prepareLandingComposer(window, workspacePath);

    await expect(window.getByRole('navigation', { name: 'Workspace context' })).toBeVisible();
    await expect(window.getByRole('textbox')).toBeVisible();
    await expect(window.getByText('Agent V is ready in this workspace.')).toHaveCount(0);
    await expect(window.getByText(/search · .* queue · @ files · \/ skills/)).toHaveCount(0);
  });

  test('landing git context shows ahead and behind sync suffix', async ({ window, electronApp }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-landing-sync-'));
    execSync('git init', { cwd: workspacePath, stdio: 'ignore' });

    await stubWorkspaceGitStatus(electronApp, {
      isRepo: true,
      branch: 'main',
      headShort: 'abc1234',
      dirtyCount: 0,
      ahead: 2,
      behind: 1
    });

    await prepareLandingComposer(window, workspacePath);

    await expect(window.getByRole('button', { name: 'Branch main ↑2 ↓1' })).toBeVisible();
  });
});
