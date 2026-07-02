/**
 * Legacy context-packs shim — delegates to the skills registry.
 * Kept so harness boot tests and HarnessPanel overrides keep working during migration.
 */

import type { ContextPackId } from '@shared/types/harness.js';
import { isBundledSkillName } from '@shared/types/skills.js';
import { getBundledSkillBody, readBundledSkillRaw, assertBundledSkillsPresent } from '../skills/bundledSkills.js';
import { logger } from '../logging/logger.js';

const log = logger.child('harness/contextPacks');

export function readBundledContextPack(id: ContextPackId): string {
  if (isBundledSkillName(id)) {
    return getBundledSkillBody(id);
  }
  return '';
}

export async function warmContextPacks(): Promise<void> {
  log.debug('warmContextPacks delegated to bundled skills');
}

export function invalidateContextPacks(): void {
  /* registry invalidation handled by skillRegistry */
}

export function getContextPackBody(id: ContextPackId): string {
  if (isBundledSkillName(id)) {
    return getBundledSkillBody(id);
  }
  log.error('unknown context pack id', { id });
  return '';
}

export function assertContextPacksPresent(): void {
  assertBundledSkillsPresent();
}

export { readBundledSkillRaw };
