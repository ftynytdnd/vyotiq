/**
 * Pure helper that extracts the orchestrator's INTENT prose for a
 * given sub-agent. The intent prose is the paragraph(s) the
 * orchestrator wrote in its assistant turn immediately BEFORE the
 * FIRST `<delegate ... />` directive of that turn — i.e. the
 * natural-language explanation of WHY this worker (and any sibling
 * workers spawned in the same turn) were spawned.
 *
 * Why prose-before-FIRST-delegate, not prose-before-THIS-delegate:
 * the orchestrator's protocol is to write its plan ONCE and then
 * emit N `<delegate />` directives back-to-back. The plan applies
 * to ALL N workers collectively. Tying intent to per-delegate
 * position (the previous behaviour) gave the FIRST worker the real
 * plan and every sibling the prior `<delegate>` tag as their
 * "trailing paragraph" — which then either rendered as an empty
 * quote box (because the tag stripped to nothing) or fell back to a
 * 600-char mid-sentence slice of upstream prose (visible in the
 * audit screenshots as text starting with `{ nl_harness.rs , src/ )`
 * — a slice through the middle of a `({nl_harness.rs, src/})`
 * parenthetical). Sharing one intent across siblings matches the
 * user's mental model and eliminates both failure modes.
 *
 * The reducer maintains every orchestrator-level assistant turn as
 * an accumulator in `TimelineState.assistantTexts[id]` (orchestrator
 * turns omit `subagentId` and so land in the top-level slot). We
 * search those accumulators for the unique turn that contains a
 * matching `<delegate id="<subagentId>"` opener and then extract
 * the prose preceding the FIRST `<delegate>` in that same turn.
 *
 * Pure / no React imports — safe inside `useMemo` and unit tests.
 */

import { stripDelegatesForDisplay } from '@shared/text/strip.js';
import type { TimelineState } from '../../reducer/types.js';

/**
 * Match the FIRST `<delegate ...>` (any id) opener in a string.
 * Used to locate the boundary where the orchestrator's intent prose
 * ends — every directive AFTER this index belongs to the
 * directive block, not the plan. `\b` (word boundary) prevents
 * `<delegate-foo>` or `<delegateurl>` false-positives.
 *
 * Greedy `[^>]*` is correct here even with embedded `>` in an
 * attribute value: we only need the START index of the first
 * delegate, not a fully-parsed tag. Even if the regex prematurely
 * closes the first directive at an embedded `>`, the START index
 * is still the FIRST delegate's position — which is all the slicer
 * needs.
 */
const ANY_DELEGATE_OPENER_RE = /<delegate\b[^>]*\/?>/i;

/**
 * Match a `<delegate ... id="X" .../>` directive whose `id` attribute
 * (double- or single-quoted) is exactly the supplied subagent id.
 * Mirrors the quote-aware attribute pattern used by the main-side
 * `parseDelegates`.
 *
 * Compiled regexes are cached per `subagentId` because this helper
 * is called from a `useMemo` in `SubAgentIntentQuote` that
 * invalidates on every orchestrator-level `agent-text-delta` event
 * (the orchestrator's `assistantTexts` reference is replaced
 * immutably). Without the cache, a long streaming turn pays the
 * regex compile cost dozens of times per second per expanded
 * sub-agent.
 *
 * Cache is bounded at `OPENER_CACHE_MAX` (insertion-order LRU) so
 * even an extreme run with thousands of unique sub-agent ids keeps
 * memory predictable. Same eviction pattern the harness loader and
 * envelope cache use.
 */
const OPENER_CACHE_MAX = 128;
const openerCache = new Map<string, RegExp>();

function buildDelegateOpenerRegex(subagentId: string): RegExp {
  const cached = openerCache.get(subagentId);
  if (cached !== undefined) {
    // Re-insert so the freshest hit floats to the tail (canonical
    // Map-as-LRU trick). RegExp is stateless under the `i` flag we
    // use here (no `g`), so sharing a single instance across calls
    // is safe.
    openerCache.delete(subagentId);
    openerCache.set(subagentId, cached);
    return cached;
  }
  // Escape regex metacharacters in the id (ids are alphanumeric in
  // practice, but defensive). The opener may have other attributes
  // before `id`, after `id`, or none at all.
  const safe = subagentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<delegate\\b[^>]*\\bid\\s*=\\s*(?:"${safe}"|'${safe}')[^>]*\\/?>`,
    'i'
  );
  openerCache.set(subagentId, re);
  if (openerCache.size > OPENER_CACHE_MAX) {
    for (const oldestKey of openerCache.keys()) {
      openerCache.delete(oldestKey);
      break;
    }
  }
  return re;
}

/** Test-only invalidation hook. Production never calls this; the
 *  LRU is self-managing. */
export const __testing = {
  resetOpenerCache: (): void => {
    openerCache.clear();
  }
};

export interface DelegateContext {
  /**
   * Cleaned trailing paragraph (or sentence) the orchestrator wrote
   * BEFORE the `<delegate />` directive. Always trimmed; never
   * carries any orchestration markup. `null` when no matching turn
   * could be found (e.g. the directive was the very first thing the
   * model emitted with no preamble).
   */
  intentText: string | null;
  /**
   * Stable id of the orchestrator turn that emitted the directive.
   * Useful for keying React subtrees so a re-mounted briefing
   * doesn't re-run the strip on every render. `null` when no match.
   */
  orchestratorTurnId: string | null;
}

const EMPTY: DelegateContext = { intentText: null, orchestratorTurnId: null };

/**
 * Extract the intent prose for `subagentId` from the reducer's
 * orchestrator-level assistant accumulators. Returns `EMPTY` when:
 *
 *   - No orchestrator turn contains the directive (e.g. the
 *     directive arrived in a turn whose accumulator was pruned by
 *     an `agent-text-aborted`).
 *   - The directive is at the very start of the orchestrator's
 *     prose (nothing precedes it to surface).
 *   - The trailing paragraph is empty after trimming and
 *     orchestration-markup stripping.
 *
 * The caller is expected to pass `state.assistantTexts` (orchestrator-
 * level slot) directly — sub-agent accumulators live in
 * `state.subagents[id].assistantTexts` and would never contain a
 * delegate directive aimed at a peer.
 */
export function deriveDelegateContext(
  assistantTexts: TimelineState['assistantTexts'],
  subagentId: string
): DelegateContext {
  if (!subagentId) return EMPTY;
  const opener = buildDelegateOpenerRegex(subagentId);

  // Iterate the accumulator map; the reducer's insertion order
  // mirrors the wire order of `agent-text-delta` events, but we
  // don't rely on it — we just need to find the unique turn whose
  // body contains a directive aimed at this id.
  for (const id in assistantTexts) {
    const acc = assistantTexts[id]!;
    const text = acc.text;
    if (text.length === 0) continue;
    // Cheap precondition: does THIS turn carry OUR delegate at all?
    // The cached per-id opener is anchored on the subagent id so a
    // hit guarantees the turn is the right one.
    if (!opener.test(text)) continue;

    // Found the turn carrying our directive. Slice BEFORE the FIRST
    // `<delegate>` in that turn — siblings spawned in the same turn
    // share the plan, so they share the intent. See the file header
    // for the rationale.
    const firstMatch = ANY_DELEGATE_OPENER_RE.exec(text);
    if (!firstMatch) {
      // Defensive: opener matched, but ANY_DELEGATE_OPENER_RE didn't.
      // The two patterns disagree only if the id pattern matched
      // something that isn't actually a `<delegate>` tag — which is
      // structurally impossible given the regex shape — but exit
      // cleanly rather than throwing.
      return { intentText: null, orchestratorTurnId: id };
    }

    const head = text.slice(0, firstMatch.index);
    const intent = extractTrailingProse(head);
    if (intent.length === 0) {
      return { intentText: null, orchestratorTurnId: id };
    }
    return { intentText: intent, orchestratorTurnId: id };
  }

  return EMPTY;
}

/**
 * Reduce a slice of orchestrator prose to its trailing paragraph(s).
 *
 * Strategy:
 *   1. Trim trailing whitespace.
 *   2. Split on blank-line boundaries (`\n\n+`).
 *   3. Walk from the LAST block backwards, skipping any block whose
 *      content is entirely orchestration scaffolding (`<status>`,
 *      `<task>`, stray `<delegate>` tags from partial-stream slices,
 *      bare DSML envelopes). Such blocks would strip to zero visible
 *      characters at display time and would just crowd out the real
 *      prose from the size cap.
 *   4. Accumulate kept blocks (newest-first) until the running total
 *      crosses `MAX_INTENT_CHARS`. We ALWAYS keep at least one block
 *      so a single very long paragraph still surfaces; the cap only
 *      governs whether to ADD an earlier paragraph too.
 *   5. Strip a leading single-line bullet marker (`- foo` → `foo`)
 *      so a solitary bullet doesn't render with a dangling dash.
 *      Multi-line bullet lists keep their markers — they're really
 *      lists and the markdown renderer formats them as such.
 *
 * The previous implementation had a 600-char tail-fallback that
 * fired when the trailing block was ≤ 12 chars; it sliced mid-word
 * through the upstream plan (audit screenshot §2, intent box starting
 * with `{ nl_harness.rs , src/ )`). The new accumulator approach
 * preserves block boundaries so a slice can never start mid-sentence.
 */
const MAX_INTENT_CHARS = 1200;

/**
 * Returns `true` when `block` carries prose that will survive the
 * display-time orchestration strip. Uses the canonical
 * `stripDelegatesForDisplay` so the skip decision here is identical
 * to what `SubAgentIntentQuote` will render — no chance of keeping
 * a block whose body ("planning" inside `<status>planning</status>`,
 * task prose inside `<task>...</task>`, …) is in fact part of an
 * orchestration envelope and would vanish at render time.
 *
 * Performance: the strip is called at most once per paragraph block
 * during the backwards walk, bounded by the number of paragraphs in
 * a single orchestrator turn (typically <20). Each strip is O(N)
 * over the block length and runs against the same regexes the
 * renderer already compiles once at module load, so total per-extract
 * cost stays well under a millisecond on realistic inputs.
 */
function hasProseContent(block: string): boolean {
  return stripDelegatesForDisplay(block).trim().length > 0;
}

function extractTrailingProse(head: string): string {
  const trimmed = head.replace(/\s+$/, '');
  if (trimmed.length === 0) return '';

  const blocks = trimmed.split(/\n\s*\n+/);
  const collected: string[] = [];
  let total = 0;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!.trim();
    if (b.length === 0) continue;
    // Skip pure-scaffolding blocks (would strip to empty at display
    // time). Always keep blocks with real prose, even if they put
    // us slightly over the cap — we only enforce the cap when we'd
    // be ADDING to an existing kept block.
    if (!hasProseContent(b)) continue;
    if (collected.length > 0 && total + b.length > MAX_INTENT_CHARS) break;
    collected.unshift(b);
    total += b.length;
  }
  if (collected.length === 0) return '';
  return cleanupSingleLineBullet(collected.join('\n\n'));
}

/**
 * Strip a leading list marker from a paragraph that happens to be a
 * 1-item bullet so it doesn't render with a `- ` prefix inside the
 * quote rail. Multi-line content (real lists or multi-paragraph
 * accumulation) keeps every marker intact.
 */
function cleanupSingleLineBullet(s: string): string {
  const lines = s.split('\n');
  if (lines.length !== 1) return s;
  return lines[0]!.replace(/^\s*(?:[-*]|\d+\.)\s+/, '');
}
