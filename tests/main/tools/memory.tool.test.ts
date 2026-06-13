/**
 * Minimal run test for the `memory` tool.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryTool } from '@main/tools/memory.tool';
import type { ToolContext } from '@main/tools/types';

function ctxFor(workspacePath: string): ToolContext {
  return {
    workspacePath,
    workspaceId: 'ws',
    runId: 'r',
    conversationId: 'c',
    strictApprovals: false,
    emit: () => undefined,
    signal: new AbortController().signal
  };
}

describe('memory.tool', () => {
  let ws = '';

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'vyotiq-memory-'));
  });

  afterEach(async () => {
    try {
      await rm(ws, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('lists workspace notes when none exist yet', async () => {
    const result = await memoryTool.run(
      { action: 'list', scope: 'workspace' },
      ctxFor(ws)
    );
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/No workspace notes yet/i);
  });

  it('requires action and scope', async () => {
    const result = await memoryTool.run({}, ctxFor(ws));
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/action.*scope.*required/i);
  });
});
