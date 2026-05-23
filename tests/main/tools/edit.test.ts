/**
 * Regression test for `edit.tool.ts`'s `create: true` race-window fix.
 *
 * Previously the tool ran `fs.access(abs)` to verify the target did
 * not exist, then `fs.writeFile(abs, content, 'utf8')` to create it.
 * A concurrent process creating the file between the two calls would
 * have its content silently clobbered, and the host's `recordChange`
 * would then capture `kind: 'create'` with no `preContent` — so a
 * later Reject would unlink the file and destroy the externally-
 * created body.
 *
 * The fix uses the `wx` write flag, pushing the existence check into
 * the kernel so the write itself rejects with `EEXIST` when the
 * target already exists. This test pre-creates a file and asserts
 * the tool returns the same `'exists'` failure shape it always
 * promised — but now via the atomic kernel-side gate, not a TOCTOU
 * pre-check.
 */

import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `recordChange` writes to the workspace's checkpoint store, which
// requires a real userData path the test environment doesn't provide.
// Mock it out — the test only cares about the create branch's error
// shape. Returning a stub satisfies the `Promise<CheckpointEntry>`
// contract.
vi.mock('@main/checkpoints/index', () => ({
  recordChange: vi.fn(async () => ({
    id: 'stub',
    runId: 'r',
    conversationId: 'c',
    workspaceId: 'ws',
    filePath: 'x',
    kind: 'create' as const,
    ts: 0,
    additions: 0,
    deletions: 0,
    accepted: false,
    rejected: false,
    source: 'edit' as const
  }))
}));

import { editTool } from '@main/tools/edit.tool';
import type { ToolContext } from '@main/tools/types';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'vyotiq-edit-test-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspacePath: workspace,
    workspaceId: 'ws-1',
    runId: 'run-1',
    conversationId: 'conv-1',
    permissions: { allowAuto: true },
    strictApprovals: false,
    signal: new AbortController().signal,
    // Audit fix H-04: ConfirmOutcome shape.
    confirm: async () => ({ approved: true, reason: 'approved' as const }),
    confirmEdit: async () => ({ approved: true, acceptAllRemaining: false }),
    emit: () => {
      /* noop */
    },
    ...overrides
  };
}

describe('edit tool — create:true atomic existence gate', () => {
  it('refuses to create when the target file already exists', async () => {
    const target = join(workspace, 'already-here.txt');
    const externalBody = 'externally-created body that must not be clobbered';
    await fs.writeFile(target, externalBody, 'utf8');

    const result = await editTool.run(
      {
        path: 'already-here.txt',
        create: true,
        content: 'agent-supplied body'
      },
      makeCtx()
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('exists');
    expect(result.output).toMatch(/already exists/i);

    // Critical: the existing file must be untouched. The whole point of
    // the atomic flag is that the kernel rejects the open() before any
    // bytes land on disk.
    const onDisk = await fs.readFile(target, 'utf8');
    expect(onDisk).toBe(externalBody);
  });

  it('creates a new file when the target does not exist', async () => {
    const result = await editTool.run(
      {
        path: 'fresh.txt',
        create: true,
        content: 'hello world\n'
      },
      makeCtx()
    );

    expect(result.ok).toBe(true);
    const onDisk = await fs.readFile(join(workspace, 'fresh.txt'), 'utf8');
    expect(onDisk).toBe('hello world\n');
  });

  it('creates intermediate directories under the workspace root', async () => {
    const result = await editTool.run(
      {
        path: 'nested/dir/file.txt',
        create: true,
        content: 'nested'
      },
      makeCtx()
    );

    expect(result.ok).toBe(true);
    const onDisk = await fs.readFile(join(workspace, 'nested/dir/file.txt'), 'utf8');
    expect(onDisk).toBe('nested');
  });
});
