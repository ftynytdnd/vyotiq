/**
 * Composer skill slash helpers (re-exports shared parser + renderer catalogue check).
 */

export { parseSkillSlashInput, type ParsedSkillSlash } from '@shared/skills/parseSkillSlash.js';
import { resolveSkillAlias } from '@shared/skills/skillAliases.js';
import { vyotiq } from '../../lib/ipc.js';

/** Returns true when the skill name or alias exists in the workspace catalogue. */
export async function isKnownSkillName(
  workspaceId: string,
  skillName: string
): Promise<boolean> {
  const canonical = resolveSkillAlias(skillName);
  const skills = await vyotiq.skills.list(workspaceId);
  return skills.some((s) => s.name === canonical);
}
