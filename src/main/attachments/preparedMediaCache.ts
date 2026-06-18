/**
 * Run-scoped LRU cache for prepared vision media (base64 payloads).
 * Cleared when the orchestrator run ends to avoid retaining large buffers.
 */

import type { PreparedVisionMedia } from './prepareMediaForVision.js';

const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_MAX_BYTES = 48 * 1024 * 1024;

interface CacheEntry {
  key: string;
  value: PreparedVisionMedia;
  bytes: number;
}

export class PreparedMediaCache {
  private readonly map = new Map<string, CacheEntry>();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly maxBytes = DEFAULT_MAX_BYTES
  ) {}

  get(key: string): PreparedVisionMedia | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: PreparedVisionMedia): void {
    const bytes = value.encodedBytes;
    const existing = this.map.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.map.delete(key);
    }
    while (
      (this.map.size >= this.maxEntries || this.totalBytes + bytes > this.maxBytes) &&
      this.map.size > 0
    ) {
      const oldest = this.map.keys().next().value as string;
      const evicted = this.map.get(oldest);
      this.map.delete(oldest);
      if (evicted) this.totalBytes -= evicted.bytes;
    }
    this.map.set(key, { key, value, bytes });
    this.totalBytes += bytes;
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
  }
}

const runCaches = new Map<string, PreparedMediaCache>();

export function getPreparedMediaCache(runId: string): PreparedMediaCache {
  let cache = runCaches.get(runId);
  if (!cache) {
    cache = new PreparedMediaCache();
    runCaches.set(runId, cache);
  }
  return cache;
}

export function clearPreparedMediaCache(runId: string): void {
  const cache = runCaches.get(runId);
  cache?.clear();
  runCaches.delete(runId);
}

export function clearAllPreparedMediaCaches(): void {
  for (const cache of runCaches.values()) cache.clear();
  runCaches.clear();
}
