import { describe, expect, it } from 'vitest';
import { contextTool, seedInvokedSkills } from '@main/tools/context.tool';
import type { ToolContext } from '@main/tools/types';

function makeCtx(signal?: AbortSignal): ToolContext {
  const ac = new AbortController();
  return {
    workspacePath: '/tmp',
    workspaceId: 'test-ws',
    runId: 'test-run',
    conversationId: 'test-conv',
    signal: signal ?? ac.signal,
    emit: () => {}
  };
}

describe('context manual-only enforcement', () => {
  it('rejects load of create-skill without invoke', async () => {
    const ctx = makeCtx();
    const result = await contextTool.run({ action: 'load', skill: 'create-skill' }, ctx);
    expect(result.ok).toBe(false);
    expect(result.output).toContain('manual-invoke only');
  });

  it('allows load when seeded via slash invoke', async () => {
    const ac = new AbortController();
    seedInvokedSkills(ac.signal, ['create-skill']);
    const result = await contextTool.run(
      { action: 'load', skill: 'create-skill' },
      makeCtx(ac.signal)
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Create Agent Skill');
  });

  it('list omits manual-only skills', async () => {
    const ctx = makeCtx();
    const result = await contextTool.run({ action: 'list' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).not.toContain('create-skill');
  });
});
