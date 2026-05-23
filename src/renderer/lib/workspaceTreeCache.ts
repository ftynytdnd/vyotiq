/**
 * Renderer-side cache for `vyotiq.workspace.listTree`. The picker re-opens
 * frequently (the `+` button + every `@` mention) and the underlying
 * `fast-glob` walk is the dominant cost — a workspace at depth 5 with
 * a few hundred files is hundreds of milliseconds. Caching the result
 * for a short TTL keeps the picker snappy while still picking up newly-
 * created files within a few seconds.
 *
 * Cache invariants:
 *   - Keyed by `(workspacePath, depth)` so a workspace switch is a
 *     guaranteed miss without explicit invalidation.
 *   - TTL-bounded; expired entries fall through to a fresh listTree.
 *   - In-flight requests are deduped so two pickers opening in rapid
 *     succession share a single IPC round-trip.
 *   - `invalidate()` is exported so callers (e.g. the workspace store)
 *     can drop the cache when the user picks a different folder.
 */

import type { WorkspaceTreeResult } from '@shared/types/ipc.js';
import { vyotiq } from './ipc.js';

const TTL_MS = 5_000;

interface CacheEntry {
  workspaceKey: string;
  depth: number;
  expiresAt: number;
  value: WorkspaceTreeResult;
}

interface InflightEntry {
  workspaceKey: string;
  depth: number;
  promise: Promise<WorkspaceTreeResult>;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightEntry>();

function keyFor(workspaceKey: string, depth: number): string {
  return `${workspaceKey}::${depth}`;
}

/**
 * Fetch the workspace tree for the given depth, returning a cached value
 * if one is still fresh. The `workspaceKey` should be derived from the
 * current workspace identity (e.g. its absolute path) so a workspace
 * switch automatically misses the cache.
 *
 * Returns the full `WorkspaceTreeResult` so consumers can render a
 * truncation hint when the workspace exceeds the main-side cap.
 */
export async function getWorkspaceTree(
  workspaceKey: string,
  depth: number,
  workspaceId?: string
): Promise<WorkspaceTreeResult> {
  const k = keyFor(workspaceKey, depth);
  const now = Date.now();
  const cached = cache.get(k);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const pending = inflight.get(k);
  if (pending) return pending.promise;

  const promise = (async () => {
    try {
      const value = await vyotiq.workspace.listTree({
        depth,
        ...(workspaceId ? { workspaceId } : {})
      });
      cache.set(k, { workspaceKey, depth, expiresAt: Date.now() + TTL_MS, value });
      return value;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, { workspaceKey, depth, promise });
  return promise;
}

/**
 * Drop every cached tree. Called from the workspace store on
 * `pick()` / `set()` so a switched workspace never serves stale paths
 * from the prior root.
 */
export function invalidateWorkspaceTreeCache(): void {
  cache.clear();
  // Note: in-flight promises are intentionally left to resolve. A racing
  // listTree against the OLD workspace will still write into the (now
  // empty) cache, but the next caller's `workspaceKey` mismatch flushes
  // it on the next `getWorkspaceTree` lookup (different key → new entry).
}
