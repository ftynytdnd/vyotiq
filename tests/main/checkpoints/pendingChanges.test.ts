/**
 * Pending-changes tests. Covers the auto-accept-on-next-prompt
 * semantics and per-conversation scoping.
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
  acceptAll,
  listPending
} from '../../../src/main/checkpoints/index.js';

describe('checkpoints/pendingChanges', () => {
  it('accumulates entries under the right conversationId and acceptAll clears them', async () => {
    const workspaceId = `ws-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    const convA = `conv-${randomUUID()}`;
    const convB = `conv-${randomUUID()}`;

    await openRun({
      runId,
      conversationId: convA,
      workspaceId,
      label: 'test',
      startedAt: Date.now()
    });

    await recordChange({
      runId,
      conversationId: convA,
      workspaceId,
      filePath: 'a.ts',
      kind: 'modify',
      preContent: 'before',
      postContent: 'after',
      additions: 1,
      deletions: 1,
      source: 'edit',
      emit: () => { }
    });
    await recordChange({
      runId,
      conversationId: convA,
      workspaceId,
      filePath: 'b.ts',
      kind: 'create',
      postContent: 'new',
      additions: 1,
      deletions: 0,
      source: 'edit',
      emit: () => { }
    });

    const listedA = await listPending(convA, [workspaceId]);
    expect(listedA).toHaveLength(2);

    // Different conversation should not see A's entries.
    const listedB = await listPending(convB, [workspaceId]);
    expect(listedB).toHaveLength(0);

    // acceptAll drops every entry for that conversation.
    const dropped = await acceptAll(convA);
    expect(dropped).toBe(2);
    const afterAccept = await listPending(convA, [workspaceId]);
    expect(afterAccept).toHaveLength(0);
  });

  it('persists subagentId and source on pending rows', async () => {
    const workspaceId = `ws-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    const conversationId = `conv-${randomUUID()}`;

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'attribution',
      startedAt: Date.now()
    });

    await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath: 'delegated.ts',
      kind: 'modify',
      preContent: 'a',
      postContent: 'b',
      additions: 1,
      deletions: 1,
      source: 'edit',
      subagentId: 'A1',
      emit: () => {}
    });
    await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath: 'shell.sh',
      kind: 'modify',
      preContent: 'x',
      postContent: 'y',
      additions: 1,
      deletions: 1,
      source: 'bash',
      emit: () => {}
    });

    const listed = await listPending(conversationId, [workspaceId]);
    expect(listed.find((e) => e.filePath === 'delegated.ts')).toMatchObject({
      subagentId: 'A1',
      source: 'edit'
    });
    expect(listed.find((e) => e.filePath === 'shell.sh')).toMatchObject({
      source: 'bash'
    });
  });

  it('acceptAll with knownWorkspaceIds drops on-disk entries that the cache has not yet promoted', async () => {
    // Reproduces the cold-start auto-accept bug (review finding M3).
    // Step 1 in the host process: an earlier session writes pending
    // entries to disk under a fresh workspaceId (the cache is hot for
    // it during step 1).
    // Step 2: simulate a process restart by `vi.resetModules()` —
    // the freshly-imported `pendingChanges` instance has an empty
    // in-memory cache, but the on-disk `pending.json` still holds
    // the entries.
    // Step 3: call `acceptAll` on the new instance with
    // `knownWorkspaceIds`. The fix forces a `loadBucket` for the
    // workspace BEFORE the scan, so the disk entries are promoted
    // and dropped. Pre-fix, the cache walk found nothing and
    // `acceptAll` returned 0.

    const workspaceId = `ws-${randomUUID()}`;
    const conversationId = `conv-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;

    // Step 1 — populate disk via the standard path.
    const stage1 = await import('../../../src/main/checkpoints/index.js');
    await stage1.openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'cold-cache test',
      startedAt: Date.now()
    });
    await stage1.recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath: 'cold.ts',
      kind: 'create',
      postContent: 'cold body',
      additions: 1,
      deletions: 0,
      source: 'edit',
      emit: () => { }
    });
    // Drain in-flight writes to disk before swapping the module.
    await stage1.flushAll();

    // Step 2 — simulate cold-start.
    vi.resetModules();
    const stage2 = await import('../../../src/main/checkpoints/index.js');

    // Sanity: zero-arg `acceptAll` reproduces the pre-fix bug — the
    // cache is empty so nothing is dropped.
    const droppedColdLegacy = await stage2.acceptAll(conversationId);
    expect(droppedColdLegacy).toBe(0);

    // Step 3 — pass the workspace id list. The fix loads the bucket
    // from disk first, then drops the matching entry.
    const droppedColdFixed = await stage2.acceptAll(conversationId, [workspaceId]);
    expect(droppedColdFixed).toBe(1);

    // And the disk-side state agrees: a follow-up listPending shows
    // no entries.
    const remaining = await stage2.listPending(conversationId, [workspaceId]);
    expect(remaining).toHaveLength(0);
  });
});
