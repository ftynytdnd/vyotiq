/**
 * In-prefix skills catalogue (tier-1 metadata only).
 */

import type { SkillMeta, SkillSource } from '@shared/types/skills.js';
import { MAX_CATALOGUE_SKILLS } from '@shared/types/skills.js';
import { filterCatalogueVisibleSkills, listSkills } from './skillRegistry.js';

const SOURCE_ORDER: SkillSource[] = [
  'workspace',
  'cursor-project',
  'global',
  'cursor-global',
  'bundled'
];

const CATALOGUE_SOURCE_HEADINGS: Record<SkillSource, string> = {
  workspace: 'Workspace skills',
  'cursor-project': 'Project skills (.cursor / .agents)',
  global: 'Global skills',
  'cursor-global': 'Global Cursor skills',
  bundled: 'Built-in skills'
};

function formatSkillLine(meta: SkillMeta): string {
  const parts = [`\`${meta.name}\` — ${meta.description}`];
  if (meta.paths?.length) {
    parts.push(`Paths: ${meta.paths.map((p) => `\`${p}\``).join(', ')}`);
  }
  if (meta.disableModelInvocation) {
    parts.push('Manual invoke only (`/skill-name` or explicit user request)');
  }
  if (meta.scopeHint) {
    parts.push(`Scope: \`${meta.scopeHint}\``);
  }
  return `- ${parts.join('. ')}`;
}

export interface BuildSkillsCatalogueOpts {
  workspacePath?: string;
  /** Skill names explicitly invoked this turn (includes manual-only skills). */
  invokedSkills?: readonly string[];
}

export async function buildSkillsCatalogue(opts: BuildSkillsCatalogueOpts = {}): Promise<string> {
  const all = await listSkills(opts.workspacePath);
  const capped = filterCatalogueVisibleSkills(all, opts.invokedSkills);
  const invoked = new Set((opts.invokedSkills ?? []).map((s) => s.trim()).filter(Boolean));
  const visibleCount = all.filter((s) => {
    if (s.disableModelInvocation && !invoked.has(s.name)) return false;
    return true;
  }).length;
  const omitted = visibleCount - capped.length;

  const bySource = new Map<SkillSource, SkillMeta[]>();
  for (const s of capped) {
    const list = bySource.get(s.source) ?? [];
    list.push(s);
    bySource.set(s.source, list);
  }

  const sections: string[] = [];
  for (const source of SOURCE_ORDER) {
    const rows = bySource.get(source);
    if (!rows?.length) continue;
    sections.push(`### ${CATALOGUE_SOURCE_HEADINGS[source]}\n\n${rows.map(formatSkillLine).join('\n')}`);
  }

  const loadExample =
    '```json\n' +
    '{ "name": "context", "arguments": { "action": "load", "skill": "ast-grep-reference" } }\n' +
    '```';

  let body =
    `# On-Demand Skills\n\n` +
    `Reference workflows live in SKILL.md files discovered from the workspace and user\n` +
    `skill directories. Only metadata is in this prefix — load a skill when a step needs it:\n\n` +
    `${loadExample}\n\n` +
    `Loaded skills return as tool results in this run's history (re-loading dedupes).\n` +
    `Load only when relevant — do not pre-load skills. Use \`paths\` metadata to self-filter.\n` +
    `Create skills at \`.vyotiq/skills/<name>/SKILL.md\` in the workspace.\n\n`;

  if (sections.length > 0) {
    body += sections.join('\n\n');
  } else {
    body += '_No skills discovered for this workspace._';
  }

  if (omitted > 0) {
    body += `\n\n_+${omitted} more skills omitted from catalogue (host cap ${MAX_CATALOGUE_SKILLS}). Use \`context action:"list"\`._`;
  }

  return body;
}
