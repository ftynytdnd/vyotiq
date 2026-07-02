/**
 * Skills IPC — list/read/create through the real preload bridge + main registry.
 */

import { access } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/electron.fixture.js';
import { seedComposerSession } from './helpers/seedComposerSession.js';

test.describe('Skills IPC', () => {
  test('skills.list returns bundled skills for a workspace', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-skills-ipc-'));
    const { workspaceId } = await seedComposerSession(window, workspacePath);

    const skills = await window.evaluate(async (wsId) => window.vyotiq.skills.list(wsId), workspaceId);

    const ast = skills.find((s: { name: string }) => s.name === 'ast-grep-reference');
    expect(ast).toBeTruthy();
    expect((ast as { source?: string }).source).toBe('bundled');

    const createSkill = skills.find((s: { name: string }) => s.name === 'create-skill');
    expect(createSkill).toBeTruthy();
    expect((createSkill as { disableModelInvocation?: boolean }).disableModelInvocation).toBe(true);
  });

  test('skills.read returns SKILL.md body for a bundled skill', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-skills-ipc-'));
    const { workspaceId } = await seedComposerSession(window, workspacePath);

    const result = await window.evaluate(
      async (wsId) => window.vyotiq.skills.read(wsId, 'ast-grep-reference'),
      workspaceId
    );

    expect((result as { raw: string }).raw.length).toBeGreaterThan(0);
    expect((result as { effective: string }).effective.length).toBeGreaterThan(0);
    expect((result as { meta: { name: string } }).meta.name).toBe('ast-grep-reference');
  });

  test('skills.create writes SKILL.md under .vyotiq/skills', async ({ window }) => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'vyotiq-e2e-skills-ipc-'));
    const { workspaceId } = await seedComposerSession(window, workspacePath);
    const skillName = 'e2e-ipc-skill';

    const created = await window.evaluate(
      async ({ wsId, name }) => window.vyotiq.skills.create(wsId, name),
      { wsId: workspaceId, name: skillName }
    );

    expect((created as { meta: { name: string } }).meta.name).toBe(skillName);

    const skillPath = path.join(workspacePath, '.vyotiq', 'skills', skillName, 'SKILL.md');
    await expect
      .poll(async () => {
        await access(skillPath);
        return true;
      })
      .toBe(true);
  });
});
