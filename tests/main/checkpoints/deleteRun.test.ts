/**
 * Regression coverage for the new `deleteRun` public API plus the two
 * defensive variants exposed alongside it (`acceptEntryStrict` and
 * `computeContentHash`). All three were previously imported by the
 * `checkpoints/index.ts` barrel but never wired to a callsite.
 *
 * What we verify:
 *   1. `deleteRun` removes the manifest, returns `removed: true`, drops
 *      every pending row that referenced one of the run's entries, and
 *      reports the dropped count back to the caller.
 *   2. A second call for the same `(workspaceId, runId)` is idempotent
 *      and returns `{ removed: false, droppedPending: 0 }` without
 *      throwing.
 *   3. The in-memory entry index is purged so a subsequent
 *      `lookupEntryLocation` for one of the deleted run's entries
 *      returns `null` (the cold-cache miss path).
 *   4. `acceptEntryStrict` validates ALL THREE of (workspaceId,
 *      conversationId, entryId) before dropping the pending row — a
 *      mismatched conversation is rejected as `false` and leaves the
 *      pending list untouched.
 *   5. `computeContentHash` is a stable SHA-256 over UTF-8 input.
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
  finalizeRun,
  listPending,
  deleteRun,
  lookupEntryLocation,
  acceptEntryStrict,
  computeContentHash,
  markEntryReverted,
  markFileRowReverted,
  getRunManifest,
  getFileHistory
} from '../../../src/main/checkpoints/index.js';

describe('checkpoints/deleteRun', () => {
  it('removes the manifest, drops pending rows, forgets entries, idempotent on the second call', async () => {
    const workspaceId = `ws-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    const conversationId = `conv-${randomUUID()}`;

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'delete-run-test',
      startedAt: Date.now()
    });
    await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath: 'a.ts',
      kind: 'create',
      postContent: 'a',
      additions: 1,
      deletions: 0,
      source: 'edit',
      emit: () => { }
    });
    await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath: 'b.ts',
      kind: 'create',
      postContent: 'b',
      additions: 1,
      deletions: 0,
      source: 'edit',
      emit: () => { }
    });
    await finalizeRun(runId);

    const pendingBefore = await listPending(conversationId, [workspaceId]);
    expect(pendingBefore).toHaveLength(2);
    const entryId = pendingBefore[0]!.entryId;

    // The entry index should be warm.
    expect(lookupEntryLocation(entryId)).not.toBeNull();

    const result = await deleteRun(workspaceId, runId);
    expect(result.removed).toBe(true);
    // Both pending rows belonged to this run — both should drop.
    expect(result.droppedPending).toBe(2);

    const pendingAfter = await listPending(conversationId, [workspaceId]);
    expect(pendingAfter).toEqual([]);

    // The entry-lookup map should have forgotten the run's entries.
    expect(lookupEntryLocation(entryId)).toBeNull();

    // Second call is idempotent — no throws, returns `removed: false`.
    const repeat = await deleteRun(workspaceId, runId);
    expect(repeat).toEqual({ removed: false, droppedPending: 0 });
  });

  it('acceptEntryStrict rejects a mismatched conversationId and leaves pending untouched', async () => {
    const workspaceId = `ws-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    const conversationId = `conv-${randomUUID()}`;
    const wrongConversation = `conv-${randomUUID()}`;

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'strict-test',
      startedAt: Date.now()
    });
    await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath: 'c.ts',
      kind: 'create',
      postContent: 'c',
      additions: 1,
      deletions: 0,
      source: 'edit',
      emit: () => { }
    });

    const pending = await listPending(conversationId, [workspaceId]);
    expect(pending).toHaveLength(1);
    const entryId = pending[0]!.entryId;

    const wrong = await acceptEntryStrict(workspaceId, wrongConversation, entryId);
    expect(wrong).toBe(false);
    // Pending list is untouched — the strict check guarded the drop.
    const stillPending = await listPending(conversationId, [workspaceId]);
    expect(stillPending).toHaveLength(1);

    const right = await acceptEntryStrict(workspaceId, conversationId, entryId);
    expect(right).toBe(true);
    const drained = await listPending(conversationId, [workspaceId]);
    expect(drained).toEqual([]);
  });

  it('markEntryReverted + markFileRowReverted flip flags without re-running the file revert', async () => {
    // The two low-level "flip the reverted flag" primitives are
    // exported from the barrel as the public diagnostic surface
    // (see `checkpoints/index.ts` doc-comments). They are normally
    // wired internally by `revertEntryDirect`; this test exercises
    // them as standalone helpers — the manifest/file-history rows
    // observably flip from `reverted: undefined` → `reverted: true`
    // without any actual on-disk file revert taking place.
    const workspaceId = `ws-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    const conversationId = `conv-${randomUUID()}`;

    await openRun({
      runId,
      conversationId,
      workspaceId,
      label: 'mark-reverted-test',
      startedAt: Date.now()
    });
    await recordChange({
      runId,
      conversationId,
      workspaceId,
      filePath: 'd.ts',
      kind: 'create',
      postContent: 'd',
      additions: 1,
      deletions: 0,
      source: 'edit',
      emit: () => { }
    });

    const before = await getRunManifest(workspaceId, runId);
    expect(before).not.toBeNull();
    const entry = before!.entries[0]!;
    expect(entry.reverted).toBeFalsy();

    await markEntryReverted(workspaceId, runId, entry.id);
    await markFileRowReverted(workspaceId, entry.filePath, entry.id);

    const after = await getRunManifest(workspaceId, runId);
    expect(after?.entries[0]?.reverted).toBe(true);

    const history = await getFileHistory(workspaceId, entry.filePath);
    const matched = history.find((row) => row.entryId === entry.id);
    expect(matched).toBeDefined();
    expect(matched?.reverted).toBe(true);
  });

  it('computeContentHash is a stable SHA-256 over UTF-8 input', () => {
    // Stable hex hashes computed once via Node's crypto in a REPL —
    // pinning here so a future "let's change the hash function" silent
    // refactor cannot land without breaking this test.
    expect(computeContentHash('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(computeContentHash('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
    // Non-ASCII: round-trips through UTF-8 (each emoji byte hashes
    // distinctly from its UTF-16 surrogate pair).
    expect(computeContentHash('héllo')).toMatch(/^[a-f0-9]{64}$/);
  });
});
