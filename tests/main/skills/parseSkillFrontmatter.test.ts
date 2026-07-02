import { describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from '@main/skills/parseSkillFrontmatter';

describe('parseSkillFrontmatter', () => {
  it('parses standard YAML frontmatter', () => {
    const raw = `---
name: deploy-app
description: Deploy the app to staging or production.
paths:
  - "**/*.ts"
disable-model-invocation: true
---

# Deploy

Steps here.
`;
    const parsed = parseSkillFrontmatter(raw, 'deploy-app');
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe('deploy-app');
    expect(parsed?.description).toContain('Deploy');
    expect(parsed?.paths).toEqual(['**/*.ts']);
    expect(parsed?.disableModelInvocation).toBe(true);
    expect(parsed?.body).toContain('# Deploy');
  });

  it('falls back to folder name when name missing', () => {
    const raw = `---
description: Do the thing.
---

Body
`;
    const parsed = parseSkillFrontmatter(raw, 'my-skill');
    expect(parsed?.name).toBe('my-skill');
  });

  it('returns null when description missing', () => {
    const raw = `---
name: x
---

Body
`;
    expect(parseSkillFrontmatter(raw, 'x')).toBeNull();
  });
});
