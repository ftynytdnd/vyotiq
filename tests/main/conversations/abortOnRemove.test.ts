/**
 * Removing a conversation (or cascading via workspace-remove) MUST
 * abort any in-flight orchestrator run pinned to it. Without this,
 * the loop keeps iterating, calling sub-agents and burning provider
 * tokens for a transcript that's about to be unlinked.
 *
 * The hook is wired by `setRunAbortHooks(...)` from
 * `registerIpc.ts` in production. Here we wire a counting stub
 * directly so the test exercises the conversation store's hook
 * dispatch independently of the orchestrator runtime.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  bulkRemoveOrReparentByWorkspace,
  createConversation,
  removeConversation,
  setRunAbortHooks
} from '@main/conversations/conversationStore';

function makeHooks() {
  const conv: string[] = [];
  const ws: string[] = [];
  return {
    conv,
    ws,
    install: () =>
      setRunAbortHooks({
        abortRunsForConversation: (id: string) => {
          conv.push(id);
          return 1;
        },
        abortRunsForWorkspace: (id: string) => {
          ws.push(id);
          return 2;
        }
      }),
    uninstall: () =>
      setRunAbortHooks({
        // Restore a pair of no-op hooks so subsequent tests in this
        // file (or in sibling files) start from a known-clean slate.
        abortRunsForConversation: () => 0,
        abortRunsForWorkspace: () => 0
      })
  };
}

beforeEach(() => {
  // Some sibling tests stub `vi.useFakeTimers`; make sure we don't
  // inherit a frozen clock here.
  vi.useRealTimers();
});

describe('conversationStore — run-abort hooks', () => {
  it('removeConversation invokes the per-conversation abort hook', async () => {
    const hooks = makeHooks();
    hooks.install();
    try {
      const meta = await createConversation('ws-A');
      await removeConversation(meta.id);
      expect(hooks.conv).toContain(meta.id);
    } finally {
      hooks.uninstall();
    }
  });

  it('bulkRemoveOrReparentByWorkspace invokes the per-workspace abort hook', async () => {
    const hooks = makeHooks();
    hooks.install();
    try {
      // Create a conversation under the target workspace so the
      // cascade has something to operate on (the function early-
      // returns when there are no targets and would skip the hook).
      await createConversation('ws-cascade');
      await bulkRemoveOrReparentByWorkspace('ws-cascade', { type: 'delete' });
      expect(hooks.ws).toContain('ws-cascade');
    } finally {
      hooks.uninstall();
    }
  });

  it('reparenting also aborts the workspace runs (the JSONL is moving out from under them)', async () => {
    const hooks = makeHooks();
    hooks.install();
    try {
      await createConversation('ws-from');
      await bulkRemoveOrReparentByWorkspace('ws-from', {
        type: 'reparent',
        targetWorkspaceId: 'ws-to'
      });
      expect(hooks.ws).toContain('ws-from');
    } finally {
      hooks.uninstall();
    }
  });

  it('removeConversation tolerates a missing hook (test-only configuration)', async () => {
    // Don't install any hook. The original behaviour is preserved.
    const meta = await createConversation('ws-nohook');
    await expect(removeConversation(meta.id)).resolves.toBeUndefined();
  });
});
