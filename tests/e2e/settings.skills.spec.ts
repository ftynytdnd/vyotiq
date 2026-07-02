/**
 * Settings → Agent behavior → Skills — browse, filter, and create workspace skills.
 */

import { access } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { prepareActiveComposer } from './helpers/seedComposerSession.js';
import { openAgentBehaviorSection, openSettings } from './helpers/settingsNavigation.js';

test.describe('Settings skills panel', () => {
  test('lists bundled skills after navigating to Skills', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-skills-'));
    await prepareActiveComposer(window, workspacePath);

    await openSettings(window);
    await openAgentBehaviorSection(window, 'skills');

    await expect(window.getByText('ast-grep-reference', { exact: true })).toBeVisible();
    await expect(window.getByText('create-skill', { exact: true })).toBeVisible();
    await expect(window.getByText('Manual only')).toBeVisible();
  });

  test('Built-in filter hides workspace-only skills', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-skills-'));
    const session = await prepareActiveComposer(window, workspacePath);

    await window.evaluate(
      async ({ wsId, name }) => window.vyotiq.skills.create(wsId, name),
      { wsId: session.workspaceId, name: 'e2e-workspace-only' }
    );

    await openSettings(window);
    await openAgentBehaviorSection(window, 'skills');

    await expect(window.getByText('e2e-workspace-only', { exact: true })).toBeVisible();
    await window.getByRole('tab', { name: 'Built-in' }).click();
    await expect(window.getByText('e2e-workspace-only', { exact: true })).toHaveCount(0);
    await expect(window.getByText('ast-grep-reference', { exact: true })).toBeVisible();
  });

  test('New skill dialog creates SKILL.md on disk', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-skills-'));
    await prepareActiveComposer(window, workspacePath);
    const skillName = 'e2e-settings-skill';

    await openSettings(window);
    await openAgentBehaviorSection(window, 'skills');

    await window.getByRole('button', { name: 'New skill' }).click();
    const dialog = window.getByRole('dialog', { name: 'New skill' });
    await expect(dialog).toBeVisible();
    await dialog.locator('input').fill(skillName);
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(
      window.getByRole('status').filter({ hasText: `Created skill "${skillName}"` })
    ).toBeVisible();

    const skillPath = path.join(workspacePath, '.vyotiq', 'skills', skillName, 'SKILL.md');
    await expect
      .poll(async () => {
        await access(skillPath);
        return true;
      })
      .toBe(true);
  });

  test('copy slash button is present for bundled skills', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-settings-skills-'));
    await prepareActiveComposer(window, workspacePath);

    await openSettings(window);
    await openAgentBehaviorSection(window, 'skills');

    await expect(window.getByRole('button', { name: 'Copy /ast-grep-reference' })).toBeVisible();
  });
});
