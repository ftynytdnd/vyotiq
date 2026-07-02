/**
 * `isSkillRelatedPath` — watcher invalidation boundaries.
 */

import { describe, expect, it } from 'vitest';
import { isSkillRelatedPath } from '@main/skills/skillDiscovery';

describe('isSkillRelatedPath', () => {
  it.each([
    ['.vyotiq/skills/review/SKILL.md', true],
    ['skills/demo/SKILL.md', true],
    ['.cursor/skills/foo/SKILL.md', true],
    ['.agents/skills/bar/SKILL.md', true],
    ['src/main/index.ts', false],
    ['SKILL.md', true]
  ])('%s → %s', (path, expected) => {
    expect(isSkillRelatedPath(path)).toBe(expected);
  });
});
