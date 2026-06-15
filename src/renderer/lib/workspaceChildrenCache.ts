/**
 * Per-folder cache for `workspace:list-children` — powers the lazy dock tree.
 */

import { vyotiq } from './ipc.js';

const TTL_MS = 5_000;

interface CacheEntry {
  workspaceKey: string;
  relativeDir: string;
  expiresAt: number;
  value: string[];
}

interface InflightEntry {
  promise: Promise<string[]>;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, InflightEntry>();

function keyFor(workspaceKey: string, relativeDir: string): string {
  const dir = relativeDir.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
  return `${workspaceKey}::${dir}`;
}

export async function getWorkspaceChildren(
  workspaceKey: string,
  relativeDir: string,
  workspaceId?: string
): Promise<string[]> {
  const normDir = relativeDir.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/$/, '');
  const k = keyFor(workspaceKey, normDir);
  const now = Date.now();
  const cached = cache.get(k);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const pending = inflight.get(k);
  if (pending) return pending.promise;

  const promise = (async () => {
    try {
      const result = await vyotiq.workspace.listChildren({
        relativeDir: normDir,
        includeDotfiles: true,
        ...(workspaceId ? { workspaceId } : {})
      });
      cache.set(k, {
        workspaceKey,
        relativeDir: normDir,
        expiresAt: Date.now() + TTL_MS,
        value: result.entries
      });
      return result.entries;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, { promise });
  return promise;
}

export function invalidateWorkspaceChildrenCache(): void {
  cache.clear();
}
