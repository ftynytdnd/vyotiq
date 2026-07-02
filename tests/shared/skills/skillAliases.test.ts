import { describe, expect, it } from 'vitest';
import { resolveSkillAlias, displaySkillSlashName } from '@shared/skills/skillAliases';

describe('skillAliases', () => {
  it('resolves known aliases', () => {
    expect(resolveSkillAlias('review')).toBe('review-checklist');
  });

  it('passes through canonical names', () => {
    expect(resolveSkillAlias('review-checklist')).toBe('review-checklist');
  });

  it('prefers short alias for display', () => {
    expect(displaySkillSlashName('review-checklist')).toBe('review');
  });
});
