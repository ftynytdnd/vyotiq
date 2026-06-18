/**
 * Cache lookup must run before dedupe so repeated read-shaped calls never
 * surface `duplicate_tool_call` when a memoized result exists.
 */

import { describe, expect, it } from 'vitest';
import { runToolByName } from '@main/orchestrator/toolRunner';
import { recordToolResult } from '@main/orchestrator/toolResultCache';
import type { ToolResult } from '@shared/types/tool';

describe('runToolByName cache before dedupe', () => {
  it('returns cached read results for 6+ identical calls without duplicate_tool_call', async () => {
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

    for (let i = 0; i < 6; i++) {
      const result = await runToolByName('read', args, opts);
      expect(result.ok).toBe(true);
      expect(result.error).not.toBe('duplicate_tool_call');
      expect(result.output).toContain('file body');
    }
  });
});
