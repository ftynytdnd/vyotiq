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
import { stableStringify } from '@shared/json/stableStringify.js';
import { logger } from '../logging/logger.js';

const log = logger.child('orchestrator/toolResultCache');

/**
 * Tool names whose (args → result) relationship is pure with respect to
 * workspace state: calling them twice in a row with no intervening
 * write produces byte-identical output. Only these are cached.
 *
 * Notably excluded:
 *   - `edit`, `delete`, `bash`, `report` — write-shaped.
 *   - `memory` — action-dependent (cached inside the key, see
 *     `cacheableKey` below; write actions invalidate).
 */
const PURE_READ_TOOLS = new Set<ToolName>(['ls', 'read', 'search', 'recall']);

/**
 * For `memory` calls, only `list` / `read` are cacheable. `write` /
 * `append` mutate and must invalidate. Returns null when the call
 * should not be cached at all (e.g. memory.write, edit, bash).
 */
function cacheableKey(name: ToolName, args: Record<string, unknown>): string | null {
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

/**
 * Predicate: does this tool call mutate workspace or memory state?
 * Returning true causes the entire run-scoped cache to be cleared so
 * subsequent reads see fresh data.
 */
function isWriteShaped(name: ToolName, args: Record<string, unknown>): boolean {
  if (name === 'edit' || name === 'delete' || name === 'bash' || name === 'report') return true;
  if (name === 'memory') {
    const action = typeof args.action === 'string' ? args.action : '';
    return action === 'write' || action === 'append';
  }
  return false;
}

interface CacheEntry {
  result: ToolResult;
  hits: number;
  firstTs: number;
  /**
   * Audit fix A4 — entry was pre-seeded by `seedCachedRead` rather than
   * recorded by an actual tool run. The lookup
   * path skips the "you already issued this N times" banner for
   * seeded entries because the seed's own `output` is the
   * authoritative explanation ("this file is already in your
   * <attached_files> block, re-read suppressed"). Without this flag the banner would
   * lie to the model on the FIRST `read` of a pre-seeded file.
   */
  seeded?: boolean;
}

/** Run-scoped cache: `WeakMap<AbortSignal, Map<entryKey, CacheEntry>>`. */
const caches = new WeakMap<AbortSignal, Map<string, CacheEntry>>();

/** Cross-run cache within one conversation (survives user-message boundaries). */
const conversationCaches = new Map<string, Map<string, CacheEntry>>();
const CONVERSATION_CACHE_MAX = 48;

function getConversationCache(conversationId: string): Map<string, CacheEntry> {
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

function clearConversationCache(conversationId: string | undefined): void {
  if (!conversationId) return;
  const map = conversationCaches.get(conversationId);
  if (map && map.size > 0) {
    log.debug('tool-result conversation cache invalidated by write', {
      conversationId,
      entriesEvicted: map.size
    });
    map.clear();
  }
}

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
    `The output has not changed. If you keep seeing this, move to a ` +
    `planning or edit step instead of re-reading.\n\n`;
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

function getCache(signal: AbortSignal): Map<string, CacheEntry> {
  let map = caches.get(signal);
  if (!map) {
    map = new Map();
    caches.set(signal, map);
  }
  return map;
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

  const runEntry = getCache(signal).get(key);
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
 * Pre-seed a synthetic cache hit for an inlined file path (host-only;
 * no live caller today — kept for tests and future inline-file hints).
 * Bare `read({ path })` short-circuits with no "[cache]" banner.
 * Idempotent per `(signal, rel)`. Audit fix A4.
 */
export function seedCachedRead(signal: AbortSignal, rel: string): void {
  const key = cacheableKey('read', { path: rel });
  if (key === null) return; // defensive — `read` is in PURE_READ_TOOLS
  const map = getCache(signal);
  if (map.has(key)) return;
  const seedResult: ToolResult = {
    id: 'seeded',
    name: 'read',
    ok: true,
    output:
      `[host] The file "${rel}" was already inlined into the <attached_files> block ` +
      `at the top of your conversation. The host has short-circuited this ` +
      `\`read\` to save you a round-trip. Use the inlined content directly. ` +
      `If you need a specific line range that exceeds the inline cap, ` +
      `re-issue \`read\` with explicit \`startLine\` / \`endLine\` — that ` +
      `call will bypass this seed and fetch fresh content.`,
    durationMs: 0
  };
  map.set(key, {
    result: seedResult,
    hits: 0,
    firstTs: Date.now(),
    seeded: true
  });
  log.debug('seeded read-cache hit', { rel });
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
    const map = caches.get(signal);
    if (map && map.size > 0) {
      log.debug('tool-result cache invalidated by write', {
        tool: name,
        entriesEvicted: map.size
      });
      map.clear();
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

  storeEntry(getCache(signal));
  if (conversationId) {
    storeEntry(getConversationCache(conversationId));
  }
}

/**
 * Drop the cache for a specific signal. Exposed for tests; production
 * relies on the WeakMap to GC entries with their signal.
 */
export function clearRunCache(signal: AbortSignal): void {
  caches.delete(signal);
}
