/**
 * Audit fix A2 — `refreshEnvelopes` LRU cache.
 *
 * Pre-fix shape: a single `envelopeCache: EnvelopeCacheEntry | null`
 * slot. Two parallel runs in different workspaces alternated-evicted
 * each other on every refresh, so the cache hit rate fell to ~0% under
 * any non-trivial multi-session usage. Correctness was always fine
 * because the key includes the run's `workspaceId` — only perf
 * suffered.
 *
 * These tests pin three properties of the bounded LRU rewrite:
 *   1. A repeated key inside the TTL window hits the cache (skipping
 *      the underlying envelope build).
 *   2. Distinct keys for parallel runs in different workspaces both
 *      survive — neither evicts the other while size ≤ MAX.
 *   3. Once size exceeds MAX, the LEAST-recently-used entry is the one
 *      evicted (insertion-order LRU).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hoisted mocks — the cache lives inside `contextManager.ts` and we
// drive it through the public `refreshEnvelopes` surface, with the
// builder's three I/O dependencies stubbed so a hit/miss is observable
// solely via call counts. The vi.fn() instances are recreated per-test
// inside `beforeEach` so spy state never leaks across cases.
vi.mock('@main/memory/retrieval', () => ({
  retrieveRelevantMemory: vi.fn()
}));
vi.mock('@main/workspace/workspaceState', () => ({
  getWorkspace: vi.fn()
}));
vi.mock('@main/conversations/conversationStore', () => ({
  listConversations: vi.fn()
}));

import {
  refreshEnvelopes,
  __resetEnvelopeCacheForTests
} from '@main/orchestrator/contextManager';
import { retrieveRelevantMemory } from '@main/memory/retrieval';
import { getWorkspace } from '@main/workspace/workspaceState';
// `listConversations` is mocked above (the builder calls it from BOTH
// `sessionContextBody` AND `priorConversationsBody`). We import the
// symbol here to seed the mock return shape; the LRU hit/miss oracle
// uses `retrieveRelevantMemory` instead because it has a single caller
// inside the builder and therefore a clean 1:1 ratio with miss count.
import { listConversations } from '@main/conversations/conversationStore';

describe('refreshEnvelopes — bounded LRU (audit A2)', () => {
  beforeEach(() => {
    __resetEnvelopeCacheForTests();
    vi.mocked(getWorkspace).mockResolvedValue({ path: null, label: null });
    vi.mocked(retrieveRelevantMemory).mockResolvedValue({
      metaRules: '',
      notes: []
    });
    vi.mocked(listConversations).mockResolvedValue([]);
  });

  // Audit fix B1: LRU key is (conversationId, workspaceId, workspacePath).
  // `query` is compared via `queryFingerprint` on hit so memory retrieval
  // cannot serve a stale envelope when the rolling query changes.
  it('hits the cache when conv, workspace, and query are unchanged', async () => {
    await refreshEnvelopes('q1', 'conv-1', undefined, 'ws-A');
    await refreshEnvelopes('q1', 'conv-1', undefined, 'ws-A');
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(1);
  });

  it('misses when the query changes for the same conv and workspace', async () => {
    await refreshEnvelopes('q1', 'conv-1', undefined, 'ws-A');
    await refreshEnvelopes('q-different', 'conv-1', undefined, 'ws-A');
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(2);
  });

  it('keeps two parallel-run keys (different workspaceId) both cached', async () => {
    // Pre-fix, this scenario thrashed: ws-A would cache, ws-B would
    // overwrite, then ws-A would re-build, etc. The bounded LRU keeps
    // both warm because MAX (8) is comfortably above 2.
    await refreshEnvelopes('q', 'conv-1', undefined, 'ws-A');
    await refreshEnvelopes('q', 'conv-2', undefined, 'ws-B');
    // Re-request both — both should hit, so the builder is NOT called
    // a third or fourth time.
    await refreshEnvelopes('q', 'conv-1', undefined, 'ws-A');
    await refreshEnvelopes('q', 'conv-2', undefined, 'ws-B');
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(2);
  });

  it('evicts the least-recently-used entry when size exceeds the cap', async () => {
    // Insert 9 distinct keys (MAX = 8). The first one should fall out
    // because it's the LRU once the 9th lands. The check: re-requesting
    // key0 forces a rebuild (miss), but re-requesting key1..8 still
    // hits. Post-B1, distinct keys come from distinct conversationIds
    // (the new key is (conv, ws, path)) — `query` no longer
    // partitions the cache.
    for (let i = 0; i < 9; i += 1) {
      await refreshEnvelopes('q', `conv-${i}`, undefined, 'ws-A');
    }
    // 9 misses so far.
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(9);

    // conv-0 was evicted — re-requesting it triggers another miss.
    await refreshEnvelopes('q', 'conv-0', undefined, 'ws-A');
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(10);

    // conv-8 is still warm — re-request hits without a rebuild.
    await refreshEnvelopes('q', 'conv-8', undefined, 'ws-A');
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(10);
  });

  it('promotes a hit so it is not the next LRU eviction', async () => {
    // Seed the cache with 8 keys.
    for (let i = 0; i < 8; i += 1) {
      await refreshEnvelopes('q', `conv-${i}`, undefined, 'ws-A');
    }
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(8);

    // Re-touch conv-0 — that should bump it to most-recently-used so
    // the next over-cap insert evicts conv-1, not conv-0.
    await refreshEnvelopes('q', 'conv-0', undefined, 'ws-A');
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(8);

    // Insert a 9th key. Now size > MAX, so the LRU (conv-1) gets
    // evicted — conv-0 must still be warm.
    await refreshEnvelopes('q', 'conv-9', undefined, 'ws-A');
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(9);

    await refreshEnvelopes('q', 'conv-0', undefined, 'ws-A');
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(9); // hit

    await refreshEnvelopes('q', 'conv-1', undefined, 'ws-A');
    expect(retrieveRelevantMemory).toHaveBeenCalledTimes(10); // miss — was evicted
  });
});
