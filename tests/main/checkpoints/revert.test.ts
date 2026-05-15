/**
 * Revert tests — exercise create / modify / delete reversal via the
 * public checkpoint-store surface, with a real workspace on disk.
 *
 * We mock `requireWorkspaceById` to return the scratch directory so
 * `revertEntryDirect` / `revertRun` / `revertFileToHash` resolve paths
 * through the same sandbox the production code uses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('../../../src/main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: vi.fn(),
  listWorkspaces: vi.fn(async () => ({ activeId: null, workspaces: [] }))
}));

import { requireWorkspaceById } from '../../../src/main/workspace/workspaceState.js';
import {
  openRun,
  finalizeRun,
  recordChange,
  revertEntryById,
  revertRun,
  revertFileToHash,
  getRunManifest,
  getFileHistory
} from '../../../src/main/checkpoints/index.js';
import type { TimelineEvent } from '../../../src/shared/types/chat.js';

function newRunCtx() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'vyotiq-ckpt-revert-'));
  const workspaceId = `ws-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  const conversationId = `conv-${randomUUID()}`;
  vi.mocked(requireWorkspaceById).mockResolvedValue(workspaceRoot);
  return { workspaceRoot, workspaceId, runId, conversationId };
}

describe('checkpoints/revert', () => {
  beforeEach(() => {
    vi.mocked(requireWorkspaceById).mockReset();
  });

  it('reverts a modify entry back to preHash content', async () => {
    const { workspaceRoot, workspaceId, runId, conversationId } = newRunCtx();
    const filePath = 'src/hello.ts';
    const abs = join(workspaceRoot, filePath);
    await fs.mkdir(join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(abs, 'console.log("A");\n', 'utf8');

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'test run',
      startedAt: Date.now()
    });

    const events: TimelineEvent[] = [];
    const emit = (e: TimelineEvent) => {
      events.push(e);
    };
    const entry = await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath,
      kind: 'modify',
      preContent: 'console.log("A");\n',
      postContent: 'console.log("B");\n',
      additions: 1,
      deletions: 1,
      source: 'edit',
      emit
    });
    // Apply the post state as the edit tool would have done.
    await fs.writeFile(abs, 'console.log("B");\n', 'utf8');

    const result = await revertEntryById(workspaceId, runId, entry.id, emit);
    expect(result).toEqual({ ok: true, reverted: 1 });
    expect(await fs.readFile(abs, 'utf8')).toBe('console.log("A");\n');

    // Manifest reflects the revert.
    const manifest = await getRunManifest(workspaceId, runId);
    expect(manifest?.entries[0]?.reverted).toBe(true);
    // `checkpoint-entry` from recordChange + `checkpoint-revert` from revert.
    expect(events.some((e) => e.kind === 'checkpoint-entry')).toBe(true);
    expect(events.some((e) => e.kind === 'checkpoint-revert')).toBe(true);
  });

  it('reverts a create entry by unlinking the file', async () => {
    const { workspaceRoot, workspaceId, runId, conversationId } = newRunCtx();
    const filePath = 'new.md';
    const abs = join(workspaceRoot, filePath);
    await fs.writeFile(abs, '# hi\n', 'utf8');

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'test run',
      startedAt: Date.now()
    });

    const entry = await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath,
      kind: 'create',
      postContent: '# hi\n',
      additions: 1,
      deletions: 0,
      source: 'edit',
      emit: () => {}
    });

    const result = await revertEntryById(workspaceId, runId, entry.id, () => {});
    expect(result.ok).toBe(true);
    expect(existsSync(abs)).toBe(false);
  });

  it('reverts a delete entry by restoring the file', async () => {
    const { workspaceRoot, workspaceId, runId, conversationId } = newRunCtx();
    const filePath = 'gone.txt';
    const abs = join(workspaceRoot, filePath);
    const original = 'will be restored\n';

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'test run',
      startedAt: Date.now()
    });

    const entry = await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath,
      kind: 'delete',
      preContent: original,
      additions: 0,
      deletions: 1,
      source: 'delete',
      emit: () => {}
    });

    // Simulate the delete tool's unlink.
    expect(existsSync(abs)).toBe(false);

    const result = await revertEntryById(workspaceId, runId, entry.id, () => {});
    expect(result.ok).toBe(true);
    expect(await fs.readFile(abs, 'utf8')).toBe(original);
  });

  it('revertRun walks entries in reverse', async () => {
    const { workspaceRoot, workspaceId, runId, conversationId } = newRunCtx();
    const filePath = 'churn.txt';
    const abs = join(workspaceRoot, filePath);

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'test run',
      startedAt: Date.now()
    });
    await fs.writeFile(abs, 'v0\n', 'utf8');

    await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath,
      kind: 'modify',
      preContent: 'v0\n',
      postContent: 'v1\n',
      additions: 1,
      deletions: 1,
      source: 'edit',
      emit: () => {}
    });
    await fs.writeFile(abs, 'v1\n', 'utf8');
    await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath,
      kind: 'modify',
      preContent: 'v1\n',
      postContent: 'v2\n',
      additions: 1,
      deletions: 1,
      source: 'edit',
      emit: () => {}
    });
    await fs.writeFile(abs, 'v2\n', 'utf8');

    const result = await revertRun(workspaceId, runId, () => {});
    expect(result).toEqual({ ok: true, reverted: 2 });
    expect(await fs.readFile(abs, 'utf8')).toBe('v0\n');
    await finalizeRun(runId);
  });

  it('revertFileToHash restores arbitrary snapshot by hash', async () => {
    const { workspaceRoot, workspaceId, runId, conversationId } = newRunCtx();
    const filePath = 'pick.txt';
    const abs = join(workspaceRoot, filePath);

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'test run',
      startedAt: Date.now()
    });
    await fs.writeFile(abs, 'original\n', 'utf8');
    const entry = await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath,
      kind: 'modify',
      preContent: 'original\n',
      postContent: 'changed\n',
      additions: 1,
      deletions: 1,
      source: 'edit',
      emit: () => {}
    });
    await fs.writeFile(abs, 'changed\n', 'utf8');

    // Revert to the pre-hash via the file-history IPC path.
    const preHash = entry.preHash!;
    const result = await revertFileToHash(workspaceId, filePath, preHash, () => {});
    expect(result.ok).toBe(true);
    expect(await fs.readFile(abs, 'utf8')).toBe('original\n');

    // File history still knows about the entry.
    const rows = await getFileHistory(workspaceId, filePath);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.preHash).toBe(preHash);
  });
});
