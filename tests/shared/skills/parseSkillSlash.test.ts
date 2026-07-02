import { describe, expect, it } from 'vitest';
import { parseAutomationPrompt, parseSkillSlashInput } from '@shared/skills/parseSkillSlash.js';

describe('parseSkillSlashInput', () => {
  it('extracts skill name and remainder prompt', () => {
    const result = parseSkillSlashInput('/deploy-app run staging deploy');
    expect(result.invokedSkill).toBe('deploy-app');
    expect(result.prompt).toBe('run staging deploy');
  });

  it('uses default prompt when only slash skill', () => {
    const result = parseSkillSlashInput('/ast-grep-reference');
    expect(result.invokedSkill).toBe('ast-grep-reference');
    expect(result.prompt).toContain('Invoke skill');
  });

  it('returns null skill for normal prompts', () => {
    const result = parseSkillSlashInput('fix the bug in main.ts');
    expect(result.invokedSkill).toBeNull();
    expect(result.slashToken).toBeNull();
    expect(result.prompt).toBe('fix the bug in main.ts');
  });

  it('resolves skill aliases to canonical names', () => {
    const result = parseSkillSlashInput('/review run on my diff');
    expect(result.slashToken).toBe('review');
    expect(result.invokedSkill).toBe('review-checklist');
    expect(result.prompt).toBe('run on my diff');
  });
});

describe('parseAutomationPrompt', () => {
  it('omits invokedSkill when prompt has no slash skill', () => {
    expect(parseAutomationPrompt('hello')).toEqual({ prompt: 'hello' });
  });

  it('includes invokedSkill for slash prompts', () => {
    expect(parseAutomationPrompt('/review audit')).toEqual({
      prompt: 'audit',
      invokedSkill: 'review-checklist'
    });
  });
});
