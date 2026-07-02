import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { highlightSkillName } from '@renderer/components/composer/skillSlash/skillSlashHighlight';

describe('highlightSkillName', () => {
  it('returns plain slash name when query is empty', () => {
    expect(highlightSkillName('deploy-app', '')).toBe('/deploy-app');
  });

  it('returns plain slash name when query does not match', () => {
    expect(highlightSkillName('deploy-app', 'xyz')).toBe('/deploy-app');
  });

  it('returns a fragment with mark when query matches', () => {
    const result = highlightSkillName('ast-grep-reference', 'grep');
    expect(isValidElement(result)).toBe(true);
    expect(result).not.toBe('/ast-grep-reference');
  });

  it('is case-insensitive', () => {
    const result = highlightSkillName('Create-Skill', 'create');
    expect(isValidElement(result)).toBe(true);
  });
});
