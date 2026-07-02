/** Agent Skills — filesystem-backed SKILL.md discovery and loading. */

export const SKILL_FILENAME = 'SKILL.md';

export const VYOTIQ_SKILLS_DIR = 'skills';

export type SkillSource =
  | 'bundled'
  | 'workspace'
  | 'global'
  | 'cursor-project'
  | 'cursor-global';

/** Human-readable labels for skill sources (catalogue, Settings). */
export const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  bundled: 'Built-in',
  workspace: 'Workspace',
  global: 'Global',
  'cursor-project': 'Project',
  'cursor-global': 'Global Cursor'
};

export interface SkillMeta {
  name: string;
  description: string;
  source: SkillSource;
  /** Directory containing SKILL.md (skill root). */
  rootPath: string;
  /** Absolute path to SKILL.md. */
  skillMdPath: string;
  paths?: string[];
  disableModelInvocation?: boolean;
  /** Monorepo hint when discovered under a nested skills root. */
  scopeHint?: string;
}

export interface ParsedSkillFrontmatter {
  name: string;
  description: string;
  paths?: string[];
  disableModelInvocation?: boolean;
  body: string;
}

export const MAX_SKILL_BODY_BYTES = 256 * 1024;
export const MAX_CATALOGUE_SKILLS = 200;

/** Legacy context-pack ids map to bundled skill names (compat alias). */
export const LEGACY_PACK_TO_SKILL: Record<string, string> = {
  'ast-grep-reference': 'ast-grep-reference',
  deliverables: 'deliverables',
  'static-examples': 'static-examples'
};

export const BUNDLED_SKILL_NAMES = [
  'ast-grep-reference',
  'deliverables',
  'static-examples',
  'review-checklist',
  'pipeline-recipes',
  'create-skill'
] as const;

export type BundledSkillName = (typeof BUNDLED_SKILL_NAMES)[number];

export function isBundledSkillName(name: string): name is BundledSkillName {
  return (BUNDLED_SKILL_NAMES as readonly string[]).includes(name);
}

export function resolveLegacyPackId(packOrSkill: string): string {
  return LEGACY_PACK_TO_SKILL[packOrSkill] ?? packOrSkill;
}
