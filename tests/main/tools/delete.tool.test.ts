/**
 * Minimal run test for the `delete` tool.
 */

import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/checkpoints/index', () => ({
  recordChange: vi.fn(async () => ({
    id: 'stub',
    runId: 'r',
    conversationId: 'c',
    workspaceId: 'ws',
    filePath: 'x',
    kind: 'delete' as const,
    ts: 0,
    additions: 0,
    deletions: 1,
    accepted: false,
    rejected: false,
    source: 'delete' as const
  }))
}));

import { deleteTool } from '@main/tools/delete.tool';
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

describe('delete.tool', () => {
  let ws = '';

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'vyotiq-delete-'));
  });

  afterEach(async () => {
    try {
      await rm(ws, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('deletes an existing text file', async () => {
    const rel = 'remove-me.txt';
    await fs.writeFile(join(ws, rel), 'line one\nline two\n', 'utf8');

    const result = await deleteTool.run({ path: rel }, ctxFor(ws));
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/Deleted remove-me\.txt/);
    await expect(fs.stat(join(ws, rel))).rejects.toThrow();
  });

  it('fails when path is missing', async () => {
    const result = await deleteTool.run({}, ctxFor(ws));
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/path.*required/i);
  });
});
