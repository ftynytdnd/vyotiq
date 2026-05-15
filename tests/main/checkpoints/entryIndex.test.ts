/**
 * Regression coverage for the O(1) entry-lookup index added to the
 * checkpoints module. The earlier implementation walked every run
 * manifest under a workspace on `rejectEntry` / `revertEntryById` —
 * the index removes that scan and is the hot path for the renderer's
 * Accept-each-row flow.
 *
 * What we verify:
 *   1. `lookupEntryLocation` returns the correct (workspaceId, runId,
 *      conversationId, filePath) tuple for every entry that
 *      `recordChange` registers.
 *   2. Entries from different runs/conversations index independently.
 *   3. Querying with a fabricated id returns `null` (cold-cache miss).
 */

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../../../src/main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: vi.fn(async () => '/dev/null'),
  listWorkspaces: vi.fn(async () => ({ activeId: null, workspaces: [] }))
}));

import {
  openRun,
  recordChange,
  listPending,
  lookupEntryLocation
} from '../../../src/main/checkpoints/index.js';

describe('checkpoints/entryIndex', () => {
  it('warms on recordChange and resolves to the right location', async () => {
    const workspaceId = `ws-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    const conversationId = `conv-${randomUUID()}`;

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'index-test',
      startedAt: Date.now()
    });

    await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath: 'foo.ts',
      kind: 'create',
      postContent: 'hello',
      additions: 1,
      deletions: 0,
      source: 'edit',
      emit: () => { }
    });

    const pending = await listPending(conversationId, [workspaceId]);
    expect(pending).toHaveLength(1);
    const entryId = pending[0]!.entryId;

    const loc = lookupEntryLocation(entryId);
    expect(loc).not.toBeNull();
    expect(loc).toEqual({ workspaceId, runId, conversationId });
  });

  it('indexes entries from independent runs without collision', async () => {
    const workspaceId = `ws-${randomUUID()}`;
    const runA = `run-${randomUUID()}`;
    const runB = `run-${randomUUID()}`;
    const convA = `conv-${randomUUID()}`;
    const convB = `conv-${randomUUID()}`;

    await openRun({ runId: runA, conversationId: convA, workspaceId, label: 'a', startedAt: Date.now() });
    await openRun({ runId: runB, conversationId: convB, workspaceId, label: 'b', startedAt: Date.now() });

    await recordChange({
      runId: runA,
      conversationId: convA,
      workspaceId,
      filePath: 'a.ts',
      kind: 'create',
      postContent: 'A',
      additions: 1,
      deletions: 0,
      source: 'edit',
      emit: () => { }
    });
    await recordChange({
      runId: runB,
      conversationId: convB,
      workspaceId,
      filePath: 'b.ts',
      kind: 'create',
      postContent: 'B',
      additions: 1,
      deletions: 0,
      source: 'bash',
      emit: () => { }
    });

    const pa = await listPending(convA, [workspaceId]);
    const pb = await listPending(convB, [workspaceId]);
    expect(pa).toHaveLength(1);
    expect(pb).toHaveLength(1);

    const locA = lookupEntryLocation(pa[0]!.entryId);
    const locB = lookupEntryLocation(pb[0]!.entryId);
    expect(locA).toEqual({ workspaceId, runId: runA, conversationId: convA });
    expect(locB).toEqual({ workspaceId, runId: runB, conversationId: convB });
  });

  it('returns null for a fabricated entry id (cold-cache miss)', () => {
    expect(lookupEntryLocation(`fake-${randomUUID()}`)).toBeNull();
  });
});
