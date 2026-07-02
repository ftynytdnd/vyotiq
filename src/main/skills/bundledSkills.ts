/**
 * Built-in skills migrated from legacy on-demand context packs.
 */

import type { BundledSkillName, SkillMeta } from '@shared/types/skills.js';
import { BUNDLED_SKILL_NAMES, SKILL_FILENAME } from '@shared/types/skills.js';
import { parseSkillFrontmatter } from './parseSkillFrontmatter.js';

import astGrepSkill from './bundled/ast-grep-reference/SKILL.md?raw';
import deliverablesSkill from './bundled/deliverables/SKILL.md?raw';
import staticExamplesSkill from './bundled/static-examples/SKILL.md?raw';
import reviewChecklistSkill from './bundled/review-checklist/SKILL.md?raw';
import pipelineRecipesSkill from './bundled/pipeline-recipes/SKILL.md?raw';

import createSkillSkill from './bundled/create-skill/SKILL.md?raw';

const BUNDLED_RAW: Record<BundledSkillName, string> = {
  'ast-grep-reference': astGrepSkill,
  deliverables: deliverablesSkill,
  'static-examples': staticExamplesSkill,
  'review-checklist': reviewChecklistSkill,
  'pipeline-recipes': pipelineRecipesSkill,
  'create-skill': createSkillSkill
};

const BUNDLED_META: Record<BundledSkillName, Omit<SkillMeta, 'rootPath' | 'skillMdPath'>> = {
  'ast-grep-reference': {
    name: 'ast-grep-reference',
    description:
      'Metavariables, search/sg JSON shapes, YAML rules, and node kinds. Load before writing ast-grep search/sg patterns or YAML rules.',
    source: 'bundled'
  },
  deliverables: {
    name: 'deliverables',
    description:
      'When to keep timeline Markdown vs emit an HTML report, plus report CSS classes. Load before large/tabular deliverables or calling report.',
    source: 'bundled'
  },
  'static-examples': {
    name: 'static-examples',
    description:
      'Worked examples: read-before-edit, AST search, ask_user, PowerShell-safe bash, sg rewrite. Load when you want a concrete tool-call pattern.',
    source: 'bundled'
  },
  'review-checklist': {
    name: 'review-checklist',
    description:
      'Structured self-audit rubric before finish — unsourced claims, test evidence, goal fit, constraint checklist. Load before finishing multi-step or publishable work.',
    source: 'bundled'
  },
  'pipeline-recipes': {
    name: 'pipeline-recipes',
    description:
      'Repeatable long-horizon workflow recipes — scheduled runs, heartbeat, skills, and todos for hands-off pipelines without sub-agents.',
    source: 'bundled'
  },
  'create-skill': {
    name: 'create-skill',
    description:
      'Interactive workflow to author a new Agent Skill at .vyotiq/skills/<name>/SKILL.md. Invoke via /create-skill when the user wants a reusable workflow.',
    source: 'bundled',
    disableModelInvocation: true
  }
};

export function listBundledSkillMetas(): SkillMeta[] {
  return BUNDLED_SKILL_NAMES.map((name) => ({
    ...BUNDLED_META[name],
    rootPath: `bundled://${name}`,
    skillMdPath: `bundled://${name}/${SKILL_FILENAME}`
  }));
}

export function readBundledSkillRaw(name: BundledSkillName): string {
  return BUNDLED_RAW[name];
}

export function getBundledSkillBody(name: BundledSkillName): string {
  const raw = BUNDLED_RAW[name];
  const parsed = parseSkillFrontmatter(raw, name);
  if (parsed?.body.trim()) return parsed.body.trim();
  return raw.trim();
}

export function assertBundledSkillsPresent(): void {
  for (const name of BUNDLED_SKILL_NAMES) {
    const body = getBundledSkillBody(name);
    if (body.length === 0) {
      throw new Error(`skills boot: bundled skill "${name}" missing or empty`);
    }
  }
}
