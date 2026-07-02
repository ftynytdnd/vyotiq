/**
 * Tests for the `context` tool — on-demand Agent Skills.
 *
 * Covers:
 *   - `action:'list'` returns the skills catalogue.
 *   - A second `list` within a run is deduped to a banner.
 *   - `action:'load'` returns a skill body.
 *   - Re-loading the same skill within a run is deduped to a banner.
 *   - Unknown / missing skill names fail gracefully.
 *   - `context` is on the solo-agent `AGENT_TOOLS` allowlist.
 */

import { describe, expect, it } from 'vitest';
import { contextTool } from '@main/tools/context.tool';
import { AGENT_TOOLS } from '@main/tools/policy/agentTools';
import { getTool } from '@main/tools/registry';
import { CONTEXT_PACK_IDS } from '@shared/types/harness';
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

describe('context tool', () => {
  it('action:"list" returns the skills catalogue', async () => {
    const result = await contextTool.run({ action: 'list' }, makeCtx());
    expect(result.ok).toBe(true);
    expect(result.name).toBe('context');
    for (const id of CONTEXT_PACK_IDS) {
      expect(result.output).toContain(id);
    }
    if (result.data?.tool === 'context') {
      expect(result.data.action).toBe('list');
      expect(result.data.alreadyListed).toBe(false);
    } else {
      throw new Error('expected context list data');
    }
  });

  it('dedupes a second list within a run', async () => {
    const ctx = makeCtx();
    const first = await contextTool.run({ action: 'list' }, ctx);
    const second = await contextTool.run({ action: 'list' }, ctx);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.output).toContain('already listed');
    if (first.data?.tool === 'context' && second.data?.tool === 'context') {
      expect(first.data.alreadyListed).toBe(false);
      expect(second.data.alreadyListed).toBe(true);
    } else {
      throw new Error('expected context list data');
    }
  });

  it('treats separate runs (signals) independently for list dedupe', async () => {
    const a = await contextTool.run({ action: 'list' }, makeCtx());
    const b = await contextTool.run({ action: 'list' }, makeCtx());
    expect(a.data?.tool === 'context' && a.data.alreadyListed).toBe(false);
    expect(b.data?.tool === 'context' && b.data.alreadyListed).toBe(false);
  });

  it('action:"load" returns the skill body via pack alias', async () => {
    const result = await contextTool.run(
      { action: 'load', pack: 'ast-grep-reference' },
      makeCtx()
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('ast-grep');
    expect(result.output).toContain('Metavariables');
    if (result.data?.tool === 'context' && result.data.action === 'load') {
      expect(result.data.skill ?? result.data.pack).toBe('ast-grep-reference');
      expect(result.data.alreadyLoaded).toBe(false);
    } else {
      throw new Error('expected context load data');
    }
  });

  it('action:"load" accepts skill argument', async () => {
    const result = await contextTool.run(
      { action: 'load', skill: 'deliverables' },
      makeCtx()
    );
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Deliverables');
  });

  it('dedupes a second load of the same pack within a run', async () => {
    const ctx = makeCtx();
    const first = await contextTool.run({ action: 'load', pack: 'deliverables' }, ctx);
    const second = await contextTool.run({ action: 'load', pack: 'deliverables' }, ctx);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.output).toContain('already loaded');
    if (second.data?.tool === 'context' && second.data.action === 'load') {
      expect(second.data.alreadyLoaded).toBe(true);
    } else {
      throw new Error('expected context load data');
    }
  });

  it('treats separate runs (signals) independently for dedupe', async () => {
    const a = await contextTool.run({ action: 'load', pack: 'static-examples' }, makeCtx());
    const b = await contextTool.run({ action: 'load', pack: 'static-examples' }, makeCtx());
    expect(a.data?.tool === 'context' && a.data.alreadyLoaded).toBe(false);
    expect(b.data?.tool === 'context' && b.data.alreadyLoaded).toBe(false);
  });

  it('rejects a missing pack on load', async () => {
    const result = await contextTool.run({ action: 'load' }, makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('missing skill');
  });

  it('rejects an unknown pack id', async () => {
    const result = await contextTool.run({ action: 'load', pack: 'nope' }, makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unknown skill');
  });

  it('rejects an unknown action', async () => {
    const result = await contextTool.run({ action: 'frobnicate' }, makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid action');
  });

  it('is registered and on the agent allowlist', () => {
    expect(getTool('context')).toBe(contextTool);
    expect(AGENT_TOOLS).toContain('context');
  });
});
