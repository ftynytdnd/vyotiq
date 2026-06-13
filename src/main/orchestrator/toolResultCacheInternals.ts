/**
 * Shared run-scoped tool-result cache state — used by `toolResultCache`
 * and the test-only `seedCachedRead` helper.
 */

import type { ToolName, ToolResult } from '@shared/types/tool.js';
import { stableStringify } from '@shared/json/stableStringify.js';

export interface CacheEntry {
  result: ToolResult;
  hits: number;
  firstTs: number;
  /** Pre-seeded by `seedCachedRead` — lookup skips the repeat banner. */
  seeded?: boolean;
}

const PURE_READ_TOOLS = new Set<ToolName>(['ls', 'read', 'search', 'recall']);

export function cacheableKey(name: ToolName, args: Record<string, unknown>): string | null {
  if (PURE_READ_TOOLS.has(name)) {
    return `${name}|${stableStringify(args)}`;
  }
  if (name === 'memory') {
    const action = typeof args.action === 'string' ? args.action : '';
    if (action === 'list' || action === 'read') {
      return `${name}|${stableStringify(args)}`;
    }
  }
  return null;
}

export function readCacheKey(args: Record<string, unknown>): string | null {
  return cacheableKey('read', args);
}

export function isWriteShaped(name: ToolName, args: Record<string, unknown>): boolean {
  if (name === 'edit' || name === 'delete' || name === 'bash' || name === 'report') return true;
  if (name === 'memory') {
    const action = typeof args.action === 'string' ? args.action : '';
    return action === 'write' || action === 'append';
  }
  return false;
}

const caches = new WeakMap<AbortSignal, Map<string, CacheEntry>>();

export function getRunCacheMap(signal: AbortSignal): Map<string, CacheEntry> {
  let map = caches.get(signal);
  if (!map) {
    map = new Map();
    caches.set(signal, map);
  }
  return map;
}

export function deleteRunCache(signal: AbortSignal): void {
  caches.delete(signal);
}

const conversationCaches = new Map<string, Map<string, CacheEntry>>();
const CONVERSATION_CACHE_MAX = 48;

export function getConversationCache(conversationId: string): Map<string, CacheEntry> {
  let map = conversationCaches.get(conversationId);
  if (!map) {
    map = new Map();
    conversationCaches.set(conversationId, map);
    if (conversationCaches.size > CONVERSATION_CACHE_MAX) {
      const oldest = conversationCaches.keys().next().value;
      if (oldest !== undefined) conversationCaches.delete(oldest);
    }
  }
  return map;
}

export function clearConversationCache(conversationId: string | undefined): void {
  if (!conversationId) return;
  conversationCaches.get(conversationId)?.clear();
}

export function getRunCacheEntryCount(signal: AbortSignal): number {
  return caches.get(signal)?.size ?? 0;
}

export function clearRunCacheEntries(signal: AbortSignal): void {
  caches.get(signal)?.clear();
}
