import { describe, expect, it } from 'vitest';
import { buildSkillsCatalogue } from '@main/skills/buildSkillsCatalogue';
import { listBundledSkillMetas } from '@main/skills/bundledSkills';

describe('buildSkillsCatalogue', () => {
  it('includes bundled skills by default', async () => {
    const text = await buildSkillsCatalogue();
    expect(text).toContain('# On-Demand Skills');
    for (const meta of listBundledSkillMetas().filter((m) => !m.disableModelInvocation)) {
      expect(text).toContain(`\`${meta.name}\``);
      expect(text).toContain(meta.description.slice(0, 20));
    }
  });

  it('includes load example with skill argument', async () => {
    const text = await buildSkillsCatalogue();
    expect(text).toContain('"skill": "ast-grep-reference"');
  });

  it('includes manual-only skill when invoked', async () => {
    const text = await buildSkillsCatalogue({ invokedSkills: ['create-skill'] });
    expect(text).toContain('`create-skill`');
  });
});
