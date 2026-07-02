/**
 * Run-scoped memoization for idempotent tool calls.
 *
 * Observation from captured conversations: models re-ask for the same
 * `read`/`ls` over and over (14× reads of the same file in a single run
 * is not rare), burning tokens and wall-clock time on results the model
 * already has. The existing spin detector catches extreme loops but
 * doesn't help on moderate redundancy — 4 or 5 repeats that still look
 * like "progress" to the detector.
 *
 * This cache short-circuits identical (name, args) pairs for read-shaped
 * tools (`ls`, `read`, `search`, `recall`, `memory` list/read) and for
 * successful `bash` commands. The second and subsequent hits return the
 * EXACT same `output` the model got the first time, with a small system
 * banner prepended so the model can recognize the repetition and move on.
 * It never fabricates or masks data: the payload (`data`) is identical to
 * the original run.
 *
 * Scope: keyed by `AbortSignal` (one cache bucket per orchestrator run).
 *
 * Invalidation: `edit`, `delete`, `report`, `capture`, `sg apply`, and
 * `memory write/append` clear the entire run cache. Successful `bash`
 * evicts only read-shaped entries (workspace may have changed) while
 * memoizing its own result for idempotent replay.
 */

import type { ToolName, ToolResult } from '@shared/types/tool.js';
import { logger } from '../logging/logger.js';
import {
  cacheableKey,
  clearConversationCache,
  clearReadShapedCacheEntries,
  clearReadShapedConversationCache,
  clearRunCacheEntries,
  deleteRunCache,
  getConversationCache,
  getRunCacheEntryCount,
  getRunCacheMap,
  isWriteShaped,
  type CacheEntry
} from './toolResultCacheInternals.js';

import { buildSmartCacheReplay } from './toolCacheReplayPolicy.js';

const log = logger.child('orchestrator/toolResultCache');

function replayCachedEntry(
  entry: CacheEntry,
  name: ToolName,
  scope: 'run' | 'conversation',
  spinHot: boolean
): ToolResult {
  const replay = buildSmartCacheReplay(entry, name, scope, spinHot);
  log.info('tool-result cache hit', {
    tool: name,
    hits: entry.hits,
    scope,
    spinHot
  });
  return replay;
}

/**
 * Inspect the cache before dispatch. Returns:
 *   - `null` when the call is not cacheable (write-shaped, unknown,
 *     etc.) OR there is no prior cached result.
 *   - A `ToolResult` clone when a prior identical call succeeded. The
 *     returned result has the same `data` / `ok` / `error` as the
 *     original run and an augmented `output` string that prepends a
 *     one-line banner telling the model how many times it has already
 *     issued this exact call. Tool execution is skipped entirely.
 *
 * The call-ID on the returned result is left untouched by this helper.
 * The downstream tool-call handler (`handleToolCalls.ts:180`) stamps
 * `result.id = callId` AFTER `runToolByName` returns, so the cached
 * result's id is overridden with the current invocation's id at the
 * handler layer. The spread copy returned here ensures that mutation
 * does not corrupt the cached entry. A future refactor that reroutes
 * the cache hit must preserve this stamping invariant — see F-026.
 */
export function lookupCachedResult(
  signal: AbortSignal,
  name: ToolName,
  args: Record<string, unknown>,
  conversationId?: string,
  spinHot = false
): ToolResult | null {
  const key = cacheableKey(name, args);
  if (key === null) return null;

  const runEntry = getRunCacheMap(signal).get(key);
  if (runEntry?.result.ok) {
    return replayCachedEntry(runEntry, name, 'run', spinHot);
  }

  if (conversationId) {
    const convEntry = getConversationCache(conversationId).get(key);
    if (convEntry?.result.ok) {
      return replayCachedEntry(convEntry, name, 'conversation', spinHot);
    }
  }

  return null;
}

/**
 * Record a fresh tool result in the cache, OR invalidate the cache
 * wholesale when the call was a write. Callers invoke this after the
 * real tool has run (never on a cache-hit replay).
 */
function storeCacheEntry(
  signal: AbortSignal,
  conversationId: string | undefined,
  key: string,
  result: ToolResult
): void {
  const store = (target: Map<string, CacheEntry>): void => {
    if (!target.has(key)) {
      target.set(key, { result, hits: 0, firstTs: Date.now() });
    }
  };
  store(getRunCacheMap(signal));
  if (conversationId) {
    store(getConversationCache(conversationId));
  }
}

export function recordToolResult(
  signal: AbortSignal,
  name: ToolName,
  args: Record<string, unknown>,
  result: ToolResult,
  conversationId?: string
): void {
  if (name === 'bash') {
    if (!result.ok) return;
    clearReadShapedCacheEntries(signal);
    clearReadShapedConversationCache(conversationId);
    const bashKey = cacheableKey(name, args);
    if (bashKey === null) return;
    storeCacheEntry(signal, conversationId, bashKey, result);
    return;
  }

  if (isWriteShaped(name, args)) {
    if (getRunCacheEntryCount(signal) > 0) {
      log.debug('tool-result cache invalidated by write', {
        tool: name,
        entriesEvicted: getRunCacheEntryCount(signal)
      });
      clearRunCacheEntries(signal);
    }
    clearConversationCache(conversationId);
    return;
  }

  const key = cacheableKey(name, args);
  if (key === null) return;
  if (!result.ok) return;
  storeCacheEntry(signal, conversationId, key, result);
}

/**
 * Drop the cache for a specific signal. Exposed for tests; production
 * relies on the WeakMap to GC entries with their signal.
 */
export function clearRunCache(signal: AbortSignal): void {
  deleteRunCache(signal);
}
