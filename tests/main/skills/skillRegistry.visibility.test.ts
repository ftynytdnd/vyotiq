import { describe, expect, it } from 'vitest';
import {
  filterCatalogueVisibleSkills,
  listCatalogueSkillNames
} from '@main/skills/skillRegistry';
import type { SkillMeta } from '@shared/types/skills.js';
import { MAX_CATALOGUE_SKILLS } from '@shared/types/skills.js';

function meta(
  name: string,
  opts?: Partial<SkillMeta>
): SkillMeta {
  return {
    name,
    description: `desc ${name}`,
    source: 'workspace',
    rootPath: `/ws/.vyotiq/skills/${name}`,
    skillMdPath: `/ws/.vyotiq/skills/${name}/SKILL.md`,
    ...opts
  };
}

describe('filterCatalogueVisibleSkills', () => {
  it('hides manual-only skills unless invoked', () => {
    const skills = [
      meta('public'),
      meta('secret', { disableModelInvocation: true })
    ];
    const hidden = filterCatalogueVisibleSkills(skills);
    expect(hidden.map((s) => s.name)).toEqual(['public']);

    const shown = filterCatalogueVisibleSkills(skills, ['secret']);
    expect(shown.map((s) => s.name)).toEqual(['public', 'secret']);
  });

  it('caps at MAX_CATALOGUE_SKILLS', () => {
    const skills = Array.from({ length: MAX_CATALOGUE_SKILLS + 5 }, (_, i) =>
      meta(`skill-${String(i).padStart(3, '0')}`)
    );
    expect(filterCatalogueVisibleSkills(skills)).toHaveLength(MAX_CATALOGUE_SKILLS);
  });
});

describe('listCatalogueSkillNames', () => {
  it('returns bundled skill names without workspace', async () => {
    const names = await listCatalogueSkillNames();
    expect(names).toContain('ast-grep-reference');
    expect(names).not.toContain('create-skill');
  });

  it('includes manual-only skill when invoked', async () => {
    const names = await listCatalogueSkillNames(undefined, ['create-skill']);
    expect(names).toContain('create-skill');
  });
});
