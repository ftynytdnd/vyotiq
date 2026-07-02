/**
 * Short slash aliases for bundled / common skills (composer + landing chips).
 */

export const SKILL_ALIASES: Record<string, string> = {
  review: 'review-checklist',
  recipes: 'pipeline-recipes',
  deliver: 'deliverables',
  examples: 'static-examples',
  'ast-grep': 'ast-grep-reference'
};

/** Resolve a slash token to the canonical skill name. */
export function resolveSkillAlias(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return trimmed;
  return SKILL_ALIASES[trimmed] ?? trimmed;
}

/** Prefer a short alias for display when one exists. */
export function displaySkillSlashName(canonicalName: string): string {
  for (const [alias, canonical] of Object.entries(SKILL_ALIASES)) {
    if (canonical === canonicalName) return alias;
  }
  return canonicalName;
}
