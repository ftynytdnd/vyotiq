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
 * Scope: keyed by `(AbortSignal, owner)` where `owner` is the
 * orchestrator id sentinel (`'__orch__'`) or a sub-agent id. The
 * orchestrator and every sub-agent get their OWN per-run cache. This
 * matters under parallel delegation: without per-owner scoping, a read
 * issued by sub-agent A would bank into B's "you already issued this"
 * banner the moment B made the same call, even though B's first read
 * was legitimate progress and the banner text would be a lie. Worse,
 * the cached `result.id` belongs to A's tool call — replaying it under
 * B would mismatch B's `assistant.tool_calls[].id` and surface as a
 * 400 from strict providers. Per-owner buckets close both surfaces.
 *
 * Invalidation: any call to a **write-shaped** tool (`edit`, `bash`,
 * `memory write/append`) clears the OWNER's cache for that signal —
 * not the whole run-scoped cache. That keeps the orchestrator's cached
 * reads alive when a sub-agent issues a write and vice versa, while
 * still ensuring that an owner who just wrote re-reads from disk on
 * the next call. Cross-agent invalidation is intentionally NOT done:
 * the verifier feeds sub-agent `<result>` envelopes into the
 * orchestrator's history, so any state change a sub-agent makes that
 * the orchestrator should care about is signalled in-band.
 *
 * F-028 — Cross-owner staleness invariant the harness MUST maintain:
 *
 *   When a sub-agent mutates a workspace file via `edit` or `bash`, the
 *   orchestrator's cached `read` of the SAME file is now stale. The
 *   orchestrator wouldn't notice because cross-owner invalidation is
 *   off — its next identical `read` would hit the cache and return
 *   pre-write contents. The system stays consistent only because:
 *
 *     1. Every sub-agent's verified `<result>` envelope summarizes
 *        what it changed (file paths, key diffs). The orchestrator
 *        re-plans against that summary, not against re-reading the
 *        file.
 *     2. The orchestrator's harness (see `00-orchestrator-core.md`
 *        §B "Don't re-survey what you've already seen") explicitly
 *        tells the model to TRUST sub-agent reports and pivot rather
 *        than re-issuing the same `read`.
 *
 *   If the harness's "report what you changed" rule weakens — e.g. a
 *   future change reduces sub-agent `<result>` granularity below
 *   "diff-summary level" — the cross-owner-staleness window opens.
 *   Either revert that change or add a `bypassCache: true` per-call
 *   flag on `read`/`ls` so the orchestrator can force a fresh read
 *   when it has to. There is no current API for that bypass; do not
 *   add one without thinking through the spin-detector implications
 *   (a forced bypass that fires on every iteration looks like spin).
 */

import type { ToolName, ToolResult } from '@shared/types/tool.js';
import { logger } from '../logging/logger.js';

const log = logger.child('orchestrator/toolResultCache');

/**
 * Tool names whose (args → result) relationship is pure with respect to
 * workspace state: calling them twice in a row with no intervening
 * write produces byte-identical output. Only these are cached.
 *
 * Notably excluded:
 *   - `edit`, `bash` — write-shaped.
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
  if (name === 'edit' || name === 'bash') return true;
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
   * Audit fix A4 — entry was pre-seeded by `seedCachedRead` (sub-agent
   * startup) rather than recorded by an actual tool run. The lookup
   * path skips the "you already issued this N times" banner for
   * seeded entries because the seed's own `output` is the
   * authoritative explanation ("this file is already in your <files>
   * block, re-read suppressed"). Without this flag the banner would
   * lie to the model on the FIRST `read` of a pre-seeded file.
   */
  seeded?: boolean;
}

/**
 * Sentinel owner key for orchestrator-level tool calls. Sub-agents
 * pass their own ids; the orchestrator passes `undefined` which we
 * resolve to this constant.
 */
const ORCHESTRATOR_OWNER_KEY = '__orch__';

/**
 * Two-level cache: `WeakMap<AbortSignal, Map<owner, Map<entryKey, CacheEntry>>>`.
 * Outer WeakMap ties lifetime to the run; inner Map partitions cache
 * visibility per owner (orchestrator OR a specific sub-agent) so
 * parallel workers don't pollute each other's cache.
 */
const caches = new WeakMap<AbortSignal, Map<string, Map<string, CacheEntry>>>();

function getCache(
  signal: AbortSignal,
  subagentId: string | undefined
): Map<string, CacheEntry> {
  let perSignal = caches.get(signal);
  if (!perSignal) {
    perSignal = new Map();
    caches.set(signal, perSignal);
  }
  const ownerKey = subagentId ?? ORCHESTRATOR_OWNER_KEY;
  let perOwner = perSignal.get(ownerKey);
  if (!perOwner) {
    perOwner = new Map();
    perSignal.set(ownerKey, perOwner);
  }
  return perOwner;
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
  subagentId?: string
): ToolResult | null {
  const key = cacheableKey(name, args);
  if (key === null) return null;
  const entry = getCache(signal, subagentId).get(key);
  if (!entry) return null;
  // Only replay successful results. A failure that reproduced would
  // re-trigger failure handling and we'd rather let the real tool run
  // in case the underlying condition has changed (e.g. a transient
  // permission error on the first call that has since cleared).
  if (!entry.result.ok) return null;

  entry.hits += 1;
  const sincePrev = Date.now() - entry.firstTs;

  // Seeded entries (audit fix A4) carry the authoritative explanation
  // in their own `output`; the "you already issued this" banner would
  // lie to the model on the FIRST read of a pre-seeded file.
  if (entry.seeded) {
    log.info('tool-result cache hit (seeded)', {
      tool: name,
      hits: entry.hits
    });
    return { ...entry.result };
  }

  const banner =
    `[cache] This exact \`${name}\` call has already been issued ` +
    `${entry.hits} time${entry.hits === 1 ? '' : 's'} earlier in this run ` +
    `(${Math.round(sincePrev / 1000)}s ago). ` +
    `The output has not changed. If you keep seeing this, move to a ` +
    `planning or edit step instead of re-reading.\n\n`;

  log.info('tool-result cache hit', {
    tool: name,
    hits: entry.hits,
    ageMs: sincePrev
  });

  return {
    ...entry.result,
    output: banner + entry.result.output
  };
}

/**
 * Pre-seed a synthetic cache hit for a sub-agent's inlined file.
 * When the worker later calls `read({ path: <inlinedRel> })` with
 * no `startLine`/`endLine`, `lookupCachedResult` short-circuits to
 * this seed and the worker is told (with no banner pollution) that
 * the file is already in its `<files>` block. The model gets one
 * iteration's worth of provider call saved per redundant re-read —
 * the exact failure mode visible in screenshot 1 (`Read core/state.py`
 * even though it was inlined).
 *
 * Scoping: keyed by `(signal, subagentId)` exactly like organic cache
 * hits, so the orchestrator and sibling workers never see the seed.
 * The orchestrator never inlines files into its own context (it has
 * the conversation transcript instead), so seeding it would be a
 * design error and we deliberately reject `subagentId === undefined`
 * at the call site rather than silently routing into the
 * orchestrator's bucket.
 *
 * The seeded result carries `ok: true` with no `data` payload. The
 * renderer's `read` invocation card tolerates a missing payload
 * (falls through to the plain text output) and the model sees a
 * clear cache message instead of a synthesized line-numbered body
 * that would have to be kept in sync with the real `read.tool.ts`
 * format. Tradeoff favoured here: simpler + correct over complete.
 *
 * Idempotent: calling twice for the same `(signal, subagentId, rel)`
 * leaves the existing entry alone, mirroring `recordToolResult`'s
 * existing "don't clobber a live entry" rule. Audit fix A4.
 */
export function seedCachedRead(
  signal: AbortSignal,
  subagentId: string,
  rel: string
): void {
  const key = cacheableKey('read', { path: rel });
  if (key === null) return; // defensive — `read` is in PURE_READ_TOOLS
  const map = getCache(signal, subagentId);
  if (map.has(key)) return;
  const seedResult: ToolResult = {
    id: 'seeded',
    name: 'read',
    ok: true,
    output:
      `[host] The file "${rel}" was already inlined into the <files> block ` +
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
  log.debug('seeded read-cache hit', { subagentId, rel });
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
  subagentId?: string
): void {
  if (isWriteShaped(name, args)) {
    // Scoped invalidation: only clear the owner's own bucket, not the
    // entire run. Sub-agent A's write should not flush orchestrator
    // reads or sub-agent B's reads. See the file header for the
    // cross-owner-invalidation rationale.
    const perSignal = caches.get(signal);
    if (perSignal) {
      const ownerKey = subagentId ?? ORCHESTRATOR_OWNER_KEY;
      const perOwner = perSignal.get(ownerKey);
      if (perOwner && perOwner.size > 0) {
        log.debug('tool-result cache invalidated by write', {
          tool: name,
          owner: ownerKey,
          entriesEvicted: perOwner.size
        });
        perOwner.clear();
      }
    }
    return;
  }
  const key = cacheableKey(name, args);
  if (key === null) return;
  if (!result.ok) return; // never cache failures
  const map = getCache(signal, subagentId);
  if (!map.has(key)) {
    map.set(key, { result, hits: 0, firstTs: Date.now() });
  }
  // If the key already exists, lookupCachedResult should have
  // short-circuited the real call and we shouldn't be here. Overwriting
  // would hide that invariant violation; leave the original entry alone
  // so stale hit counters remain audit-friendly.
}

/**
 * Drop the cache for a specific signal. Exposed for tests; production
 * relies on the WeakMap to GC entries with their signal.
 */
export function clearRunCache(signal: AbortSignal): void {
  caches.delete(signal);
}

/**
 * Stable JSON string — sort object keys so `{a:1,b:2}` and `{b:2,a:1}`
 * produce identical cache keys. Shallow — tool argument shapes are
 * flat in practice and a full recursive sort would hurt readability
 * without measurable benefit.
 */
function stableStringify(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = args[k];
  return JSON.stringify(ordered);
}
