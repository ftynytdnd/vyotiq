/**
 * Spin-prone tools: dedupe runs before cache so a second identical call is blocked.
 */

import { describe, expect, it } from 'vitest';
import { runToolByName } from '@main/orchestrator/toolRunner';
import { recordToolResult } from '@main/orchestrator/toolResultCache';
import type { ToolResult } from '@shared/types/tool';

describe('runToolByName spin-prone dedupe before cache', () => {
  it('blocks the second identical read after a cached first replay', async () => {
    const ac = new AbortController();
    const args = { path: 'src/example.ts' };
    const opts = {
      workspacePath: process.cwd(),
      workspaceId: 'ws-test',
      runId: 'run-1',
      conversationId: 'conv-1',
      emit: () => undefined,
      signal: ac.signal
    };

    const first: ToolResult = {
      id: 'tc-1',
      name: 'read',
      ok: true,
      output: 'file body',
      durationMs: 1
    };
    recordToolResult(ac.signal, 'read', args, first, opts.conversationId);

    const replay = await runToolByName('read', args, opts);
    expect(replay.ok).toBe(true);
    expect(replay.error).not.toBe('duplicate_tool_call');
    expect(replay.output).toContain('file body');

    const blocked = await runToolByName('read', args, opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('duplicate_tool_call');
  });
});
