/**
 * Error-handling path for the `context` tool: when a skill body resolves
 * empty, `load` must fail gracefully with `ok:false` rather than returning
 * a header with no content.
 */

import { describe, expect, it, vi } from 'vitest';

const mockSkill = {
  name: 'ast-grep-reference',
  description: 'ast-grep help',
  source: 'bundled' as const,
  rootPath: 'bundled://ast-grep-reference',
  skillMdPath: 'bundled://ast-grep-reference/SKILL.md'
};

vi.mock('@main/skills/skillRegistry', () => ({
  findSkill: async () => mockSkill,
  getSkillBody: async () => '',
  listSkills: async () => [mockSkill],
  listCatalogueSkills: async () => [mockSkill]
}));

import { contextTool } from '@main/tools/context.tool';
import type { ToolContext } from '@main/tools/types';

function makeCtx(): ToolContext {
  return {
    workspacePath: '/tmp',
    workspaceId: 'test-ws',
    runId: 'test-run',
    conversationId: 'test-conv',
    signal: new AbortController().signal,
    emit: () => {}
  };
}

describe('context tool — empty skill body', () => {
  it('fails gracefully when a skill body resolves empty', async () => {
    const result = await contextTool.run(
      { action: 'load', skill: 'ast-grep-reference' },
      makeCtx()
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('empty skill body');
    expect(result.output).toContain('unavailable');
  });

  it('still lists the catalogue (list does not depend on skill bodies)', async () => {
    const result = await contextTool.run({ action: 'list' }, makeCtx());
    expect(result.ok).toBe(true);
  });
});
