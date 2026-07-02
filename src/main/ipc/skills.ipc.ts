/**
 * Skills IPC — list/read/create workspace skills for Settings UI.
 */

import { shell } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { IPC, WORKSPACE_DOTDIR } from '@shared/constants.js';
import type { SkillMeta } from '@shared/types/skills.js';
import { SKILL_FILENAME } from '@shared/types/skills.js';
import { listSkills, findSkill, readSkillFileContent, invalidateSkillRegistry } from '../skills/skillRegistry.js';
import { resetSkillOverride, writeSkillOverride } from '../skills/skillOverrides.js';
import { requireWorkspaceById } from '../workspace/workspaceState.js';
import { emitWorkspaceTreeChanged } from '../workspace/workspaceTreeWatcher.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertString } from './validate.js';

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

function skillTemplate(name: string): string {
  return `---
name: ${name}
description: Describe what this skill does and when Agent V should load it.
---

# ${name}

## When to use

- Use this skill when…

## Instructions

- Step-by-step guidance for the agent.
- Optional \`references/\` files can be loaded with the \`read\` tool.
`;
}

export function registerSkillsIpc(): void {
  wrapIpcHandler(IPC.SKILLS_LIST, async (_event, workspaceId: string) => {
    assertString('skills:list', 'workspaceId', workspaceId);
    const ws = await requireWorkspaceById(workspaceId);
    return listSkills(ws);
  });

  wrapIpcHandler(
    IPC.SKILLS_READ,
    async (_event, workspaceId: string, skillName: string) => {
      assertString('skills:read', 'workspaceId', workspaceId);
      assertString('skills:read', 'skillName', skillName);
      const ws = await requireWorkspaceById(workspaceId);
      const meta = await findSkill(skillName, ws);
      if (!meta) {
        throw new Error(`skills:read: unknown skill "${skillName}"`);
      }
      const { raw, effective } = await readSkillFileContent(meta);
      return { meta, raw, effective };
    }
  );

  wrapIpcHandler(
    IPC.SKILLS_CREATE,
    async (_event, workspaceId: string, skillName: string) => {
      assertString('skills:create', 'workspaceId', workspaceId);
      assertString('skills:create', 'skillName', skillName);
      const name = skillName.trim();
      if (!SKILL_NAME_RE.test(name)) {
        throw new Error(
          'skills:create: name must be lowercase letters, numbers, and hyphens (match folder name).'
        );
      }
      const ws = await requireWorkspaceById(workspaceId);
      const skillDir = join(ws, WORKSPACE_DOTDIR, 'skills', name);
      const skillPath = join(skillDir, SKILL_FILENAME);
      try {
        await fs.access(skillPath);
        throw new Error(`skills:create: skill "${name}" already exists.`);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      }
      const body = skillTemplate(name);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(skillPath, body, 'utf8');
      invalidateSkillRegistry();
      emitWorkspaceTreeChanged(workspaceId);
      const meta: SkillMeta = {
        name,
        description: 'Describe what this skill does and when Agent V should load it.',
        source: 'workspace',
        rootPath: skillDir,
        skillMdPath: skillPath
      };
      return { meta, path: skillPath };
    }
  );

  wrapIpcHandler(
    IPC.SKILLS_REVEAL,
    async (_event, workspaceId: string, skillName: string) => {
      assertString('skills:reveal', 'workspaceId', workspaceId);
      assertString('skills:reveal', 'skillName', skillName);
      const ws = await requireWorkspaceById(workspaceId);
      const meta = await findSkill(skillName, ws);
      if (!meta) {
        throw new Error(`skills:reveal: unknown skill "${skillName}"`);
      }
      if (meta.source === 'bundled') {
        throw new Error('skills:reveal: built-in skills are not on disk.');
      }
      await shell.showItemInFolder(meta.skillMdPath);
      return { ok: true as const };
    }
  );

  wrapIpcHandler(
    IPC.SKILLS_WRITE_OVERRIDE,
    async (_event, workspaceId: string, skillName: string, body: string) => {
      assertString('skills:write-override', 'workspaceId', workspaceId);
      assertString('skills:write-override', 'skillName', skillName);
      assertString('skills:write-override', 'body', body);
      await requireWorkspaceById(workspaceId);
      const meta = await findSkill(skillName);
      if (!meta || meta.source !== 'bundled') {
        throw new Error(`skills:write-override: unknown built-in skill "${skillName}"`);
      }
      await writeSkillOverride(skillName, body);
      invalidateSkillRegistry();
      return { ok: true as const };
    }
  );

  wrapIpcHandler(
    IPC.SKILLS_RESET_OVERRIDE,
    async (_event, workspaceId: string, skillName: string) => {
      assertString('skills:reset-override', 'workspaceId', workspaceId);
      assertString('skills:reset-override', 'skillName', skillName);
      await requireWorkspaceById(workspaceId);
      const meta = await findSkill(skillName);
      if (!meta || meta.source !== 'bundled') {
        throw new Error(`skills:reset-override: unknown built-in skill "${skillName}"`);
      }
      await resetSkillOverride(skillName);
      invalidateSkillRegistry();
      return { ok: true as const };
    }
  );
}
