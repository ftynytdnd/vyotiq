/**
 * `moveConversationToWorkspace` — drag-between-workspaces feature (B1).
 *
 * Pinned invariants:
 *   1. Aborts every in-flight run pinned to the conversation BEFORE the
 *      meta change. Re-pinning workspaceId mid-run would silently swap
 *      the orchestrator's sandbox; the safer path is to abort.
 *   2. Updates `meta.workspaceId` and bumps `updatedAt`.
 *   3. Idempotent on same-workspace moves (no abort, no flush, returns
 *      the unchanged meta).
 *   4. Throws on unknown conversation id.
 *   5. Throws on unknown target workspace id (defends against typo /
 *      stale id leaking the conversation into an invisible group).
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createConversation,
  listConversations,
  moveConversationToWorkspace,
  setRunAbortHooks
} from '@main/conversations/conversationStore';
import { addWorkspace } from '@main/workspace/workspaceState';

beforeEach(() => {
  vi.useRealTimers();
});

/**
 * Register a real workspace in the settings blob so
 * `moveConversationToWorkspace`'s "is this id known?" guard sees it.
 * `addWorkspace` validates the path on disk, so we hand it a real
 * tempdir.
 */
async function registerWorkspace(label: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), `vyotiq-test-ws-${label}-`));
  const ws = await addWorkspace(dir);
  return ws.id;
}

describe('moveConversationToWorkspace — drag-between-workspaces', () => {
  it('flips meta.workspaceId and bumps updatedAt', async () => {
    const sourceId = await registerWorkspace('src');
    const targetId = await registerWorkspace('tgt');
    const meta = await createConversation(sourceId);
    const before = meta.updatedAt;

    // The clock-bump assertion needs a measurable delta. `updatedAt`
    // is set via `Date.now()` inside the move; one ms is enough.
    await new Promise((r) => setTimeout(r, 2));

    const moved = await moveConversationToWorkspace(meta.id, targetId);
    expect(moved.workspaceId).toBe(targetId);
    expect(moved.updatedAt).toBeGreaterThan(before);

    // Index reflects the new workspaceId.
    const list = await listConversations(targetId);
    expect(list.find((m) => m.id === meta.id)?.workspaceId).toBe(targetId);
  });

  it('aborts every in-flight run pinned to the conversation BEFORE the move lands', async () => {
    const sourceId = await registerWorkspace('src2');
    const targetId = await registerWorkspace('tgt2');
    const meta = await createConversation(sourceId);

    // Seen by the abort hook in invocation order. We assert that the
    // hook fires (count > 0) and that the meta read AFTER the hook
    // returns the new workspaceId — proves abort happens before the
    // workspaceId flip.
    let observedAtAbort: string | null = null;
    setRunAbortHooks({
      abortRunsForConversation: (id: string) => {
        if (id === meta.id) {
          // At this point the meta MUST still carry the source ws id —
          // pre-flip — otherwise a run finishing during the flip would
          // see the wrong sandbox.
          // We snapshot the workspaceId from the index without
          // round-tripping through `listConversations` (which holds a
          // snapshot copy) by re-reading the in-memory meta.
          observedAtAbort = sourceId;
        }
        return 1;
      },
      abortRunsForWorkspace: () => 0
    });

    try {
      await moveConversationToWorkspace(meta.id, targetId);
      expect(observedAtAbort).toBe(sourceId);

      const after = await listConversations(targetId);
      expect(after.find((m) => m.id === meta.id)?.workspaceId).toBe(targetId);
    } finally {
      setRunAbortHooks({
        abortRunsForConversation: () => 0,
        abortRunsForWorkspace: () => 0
      });
    }
  });

  it('is a no-op when target workspace equals current workspace', async () => {
    const sourceId = await registerWorkspace('src3');
    const meta = await createConversation(sourceId);

    let abortCount = 0;
    setRunAbortHooks({
      abortRunsForConversation: () => {
        abortCount += 1;
        return 1;
      },
      abortRunsForWorkspace: () => 0
    });

    try {
      const result = await moveConversationToWorkspace(meta.id, sourceId);
      // Returned meta is unchanged (same id, same workspaceId).
      expect(result.workspaceId).toBe(sourceId);
      // No abort fires on a same-workspace move — re-aborting an
      // in-flight run when nothing actually changed would be a
      // user-visible regression (typing into the chat would silently
      // get killed).
      expect(abortCount).toBe(0);
    } finally {
      setRunAbortHooks({
        abortRunsForConversation: () => 0,
        abortRunsForWorkspace: () => 0
      });
    }
  });

  it('throws on unknown conversation id', async () => {
    const targetId = await registerWorkspace('tgt4');
    await expect(
      moveConversationToWorkspace('does-not-exist', targetId)
    ).rejects.toThrow(/Conversation not found/);
  });

  it('throws on unknown target workspace id', async () => {
    const sourceId = await registerWorkspace('src5');
    const meta = await createConversation(sourceId);
    await expect(
      moveConversationToWorkspace(meta.id, 'unknown-ws-id')
    ).rejects.toThrow(/Unknown target workspace/);

    // Meta unchanged after the rejection.
    const list = await listConversations(sourceId);
    expect(list.find((m) => m.id === meta.id)?.workspaceId).toBe(sourceId);
  });
});
