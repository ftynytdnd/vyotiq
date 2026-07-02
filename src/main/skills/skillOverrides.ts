/**
 * User overrides for bundled skills + legacy harness pack override fallback.
 */

import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BundledSkillName } from '@shared/types/skills.js';
import { isBundledSkillName } from '@shared/types/skills.js';
import { harnessOverridesDir, skillOverridesDir as skillOverridesRoot } from '../paths/userDataLayout.js';
import { logger } from '../logging/logger.js';

const log = logger.child('skills/overrides');

/** Legacy harness override filenames for the three migrated packs. */
const LEGACY_PACK_OVERRIDE_FILE: Partial<Record<BundledSkillName, string>> = {
  'ast-grep-reference': '04-ast-grep-cheatsheet.md',
  deliverables: '02-deliverables.md',
  'static-examples': '03-static-examples.md'
};

function overridePath(skillName: BundledSkillName): string {
  return join(skillOverridesRoot(), `${skillName}.md`);
}

function legacyOverridePath(skillName: BundledSkillName): string | null {
  const file = LEGACY_PACK_OVERRIDE_FILE[skillName];
  if (!file) return null;
  return join(harnessOverridesDir(), file);
}

export async function readSkillOverride(skillName: string): Promise<string | null> {
  if (!isBundledSkillName(skillName)) return null;

  const path = overridePath(skillName);
  if (existsSync(path)) {
    try {
      return await fs.readFile(path, 'utf8');
    } catch (err) {
      log.warn('read skill override failed', { skillName, err });
    }
  }

  const legacy = legacyOverridePath(skillName);
  if (legacy && existsSync(legacy)) {
    try {
      const body = await fs.readFile(legacy, 'utf8');
      log.debug('using legacy harness pack override for skill', { skillName });
      return body;
    } catch (err) {
      log.warn('read legacy pack override failed', { skillName, err });
    }
  }

  return null;
}

export async function writeSkillOverride(skillName: string, body: string): Promise<void> {
  if (!isBundledSkillName(skillName)) {
    throw new Error(`skills:write-override: "${skillName}" is not a built-in skill.`);
  }
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error('skills:write-override: body must not be empty.');
  }
  const dir = skillOverridesRoot();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(overridePath(skillName), body, 'utf8');
}

export async function resetSkillOverride(skillName: string): Promise<void> {
  if (!isBundledSkillName(skillName)) {
    throw new Error(`skills:reset-override: "${skillName}" is not a built-in skill.`);
  }
  const path = overridePath(skillName);
  if (!existsSync(path)) return;
  await fs.unlink(path);
}

