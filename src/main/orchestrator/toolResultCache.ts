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
 * This cache short-circuits identical (name, args) pairs for the subset
 * of tools that are **read-shaped and stateless** — `ls`, `read`,
 * `search`, `recall`, and `memory` in `list`/`read` actions. The second
 * and subsequent hits return the EXACT same `output` the model got the
 * first time, with a small system banner prepended so the model can
 * recognize the repetition and move on. It never fabricates or masks
 * data: the payload (`data`) is identical to the original run.
 *
 * Scope: keyed by `AbortSignal` (one cache bucket per orchestrator run).
 *
 * Invalidation: any call to a **write-shaped** tool (`edit`, `delete`,
 * `bash`, `report`, `memory write/append`) clears the run's cache so
 * subsequent reads see fresh workspace state. `delete` and `report` are
 * included because both mutate the on-disk workspace (`delete` unlinks a
 * file; `report` writes under `.vyotiq/reports`), so a previously cached
 * `read`/`ls`/`search` could otherwise return stale content.
 */

import type { ToolName, ToolResult } from '@shared/types/tool.js';
import { logger } from '../logging/logger.js';
import {
  cacheableKey,
  clearConversationCache,
  clearRunCacheEntries,
  deleteRunCache,
  getConversationCache,
  getRunCacheEntryCount,
  getRunCacheMap,
  isWriteShaped,
  type CacheEntry
} from './toolResultCacheInternals.js';

const log = logger.child('orchestrator/toolResultCache');

function replayCachedEntry(entry: CacheEntry, name: ToolName, scope: 'run' | 'conversation'): ToolResult {
  entry.hits += 1;
  if (entry.seeded) {
    log.info('tool-result cache hit (seeded)', {
      tool: name,
      hits: entry.hits,
      scope
    });
    return { ...entry.result };
  }
  const banner =
    `[cache] This exact \`${name}\` call has already been issued ` +
    `${entry.hits} time${entry.hits === 1 ? '' : 's'} earlier in this ${scope === 'conversation' ? 'conversation' : 'run'}. ` +
    `The output may be stale if a write tool ran since. Re-issue after \`edit\`/\`delete\`/\`bash\`, or use a fresh \`read\`. ` +
    `If you keep seeing this, move to planning or edit instead of re-reading.\n\n`;
  log.info('tool-result cache hit', {
    tool: name,
    hits: entry.hits,
    scope
  });
  return {
    ...entry.result,
    output: banner + entry.result.output
  };
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
  conversationId?: string
): ToolResult | null {
  const key = cacheableKey(name, args);
  if (key === null) return null;

  const runEntry = getRunCacheMap(signal).get(key);
  if (runEntry?.result.ok) {
    return replayCachedEntry(runEntry, name, 'run');
  }

  if (conversationId) {
    const convEntry = getConversationCache(conversationId).get(key);
    if (convEntry?.result.ok) {
      return replayCachedEntry(convEntry, name, 'conversation');
    }
  }

  return null;
}

/**
 * Record a fresh tool result in the cache, OR invalidate the cache
 * wholesale when the call was a write. Callers invoke this after the
 * real tool has run (never on a cache-hit replay).
 */
export function recordToolResult(
  signal: AbortSignal,
  name: ToolName,
  args: Record<string, unknown>,
  result: ToolResult,
  conversationId?: string
): void {
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

  const storeEntry = (target: Map<string, CacheEntry>): void => {
    if (!target.has(key)) {
      target.set(key, { result, hits: 0, firstTs: Date.now() });
    }
  };

  storeEntry(getRunCacheMap(signal));
  if (conversationId) {
    storeEntry(getConversationCache(conversationId));
  }
}

/**
 * Drop the cache for a specific signal. Exposed for tests; production
 * relies on the WeakMap to GC entries with their signal.
 */
export function clearRunCache(signal: AbortSignal): void {
  deleteRunCache(signal);
}
