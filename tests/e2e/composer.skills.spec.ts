/**
 * Composer skill slash commands — `/` picker, status strip, and unknown-skill create flow.
 */

import { access } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { prepareActiveComposer, typeInComposer } from './helpers/seedComposerSession.js';

const BUNDLED_SKILL_SLASH = 'ast-grep';

test.describe('Composer skill slash commands', () => {
  test('opens the skill picker when typing /', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-skills-'));
    await prepareActiveComposer(window, workspacePath);

    await typeInComposer(window, '/');

    const picker = window.getByRole('listbox', { name: 'Skills' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('option', { name: new RegExp(`/${BUNDLED_SKILL_SLASH}`) })).toBeVisible();
    await expect(picker.getByRole('option', { name: /\/create-skill/ })).toBeVisible();
  });

  test('filters skills as the slash query grows', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-skills-'));
    await prepareActiveComposer(window, workspacePath);

    await typeInComposer(window, '/ast');

    const picker = window.getByRole('listbox', { name: 'Skills' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('option', { name: new RegExp(`/${BUNDLED_SKILL_SLASH}`) })).toBeVisible();
    await expect(picker.getByRole('option', { name: /\/deliver/ })).toHaveCount(0);
  });

  test('picking a skill shows the status strip hint', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-skills-'));
    await prepareActiveComposer(window, workspacePath);

    await typeInComposer(window, `/${BUNDLED_SKILL_SLASH}`);
    await window
      .getByRole('listbox', { name: 'Skills' })
      .getByRole('option', { name: new RegExp(`/${BUNDLED_SKILL_SLASH}`) })
      .click();

    await expect(window.locator('.vx-composer-status-strip')).toContainText(`/${BUNDLED_SKILL_SLASH}`);
    await expect(window.locator('.vx-composer-status-strip')).toContainText('will load on send');
  });

  test('unknown slash opens Create skill dialog on Send', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-skills-'));
    await prepareActiveComposer(window, workspacePath);

    const missing = 'e2e-missing-skill';
    await typeInComposer(window, `/${missing} run checks`);
    await window.getByRole('button', { name: 'Send' }).click();

    const dialog = window.getByRole('dialog', { name: 'Create skill?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`"/${missing}" was not found`);
  });

  test('cancel closes the create-skill dialog without writing files', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-skills-'));
    await prepareActiveComposer(window, workspacePath);

    const missing = 'e2e-cancel-skill';
    await typeInComposer(window, `/${missing}`);
    await window.getByRole('button', { name: 'Send' }).click();
    await window
      .getByRole('dialog', { name: 'Create skill?' })
      .getByRole('button', { name: 'Cancel' })
      .click();

    await expect(window.getByRole('dialog', { name: 'Create skill?' })).toHaveCount(0);
    const skillPath = path.join(workspacePath, '.vyotiq', 'skills', missing, 'SKILL.md');
    await expect(access(skillPath)).rejects.toThrow();
  });

  test('Create & send writes SKILL.md under .vyotiq/skills', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-skills-'));
    await prepareActiveComposer(window, workspacePath);

    const skillName = 'e2e-created-skill';
    await typeInComposer(window, `/${skillName} scaffold workflow`);
    await window.getByRole('button', { name: 'Send' }).click();

    const dialog = window.getByRole('dialog', { name: 'Create skill?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Create & send' }).click();

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
});
