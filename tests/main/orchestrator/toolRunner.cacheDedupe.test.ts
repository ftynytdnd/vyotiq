/**
 * Read-shaped tools: cache replay runs before dedupe so repeats return ok
 * results with a pivot banner instead of duplicate_tool_call failures.
 */

import { describe, expect, it } from 'vitest';
import { runToolByName } from '@main/orchestrator/toolRunner';
import { recordToolResult } from '@main/orchestrator/toolResultCache';
import type { ToolResult } from '@shared/types/tool';

describe('runToolByName cache before dedupe', () => {
  it('replays the cached read on the second identical call', async () => {
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
    expect(replay.output).toContain('[cache]');

    const again = await runToolByName('read', args, opts);
    expect(again.ok).toBe(true);
    expect(again.error).not.toBe('duplicate_tool_call');
    expect(again.output).toContain('file body');
  });

  it('replays cached bash on the second identical call', async () => {
    const ac = new AbortController();
    const args = { command: 'git init' };
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
      name: 'bash',
      ok: true,
      output: '--- stdout ---\nInitialized empty Git repository\n--- exit: 0 ---',
      durationMs: 1
    };
    recordToolResult(ac.signal, 'bash', args, first, opts.conversationId);

    const replay = await runToolByName('bash', args, opts);
    expect(replay.ok).toBe(true);
    expect(replay.error).not.toBe('duplicate_tool_call');
    expect(replay.output).toContain('Initialized empty Git repository');
    expect(replay.output).toContain('[cache]');
  });
});
