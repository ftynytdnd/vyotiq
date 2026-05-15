/**
 * `<delegate ... />` directive parser.
 *
 * The orchestrator's only mechanism for spawning ephemeral sub-agents is to
 * emit one or more `<delegate id="A1" task="..." files="..." tools="..." />`
 * directives in its assistant text. The host parses those directives,
 * spawns the swarm in parallel, and feeds verified results back into the
 * orchestrator's context.
 */

export interface ParsedDelegate {
  id: string;
  task: string;
  files: string[];
  tools: string[];
}

/**
 * Richer return shape that surfaces directives DROPPED by the per-turn
 * id-dedup. The bare `parseDelegates(text)` form discards duplicates
 * silently for backward compatibility; callers that want observability
 * (e.g. emit a `phase` event so the user sees "duplicate delegate id
 * A1 dropped") use `parseDelegatesWithDuplicates(text)` instead.
 *
 * `duplicates` lists each id that appeared MORE than once in the
 * input, in the order the duplicate was encountered. The first
 * occurrence is always kept; only the 2nd, 3rd, … land here.
 */
export interface ParseDelegatesResult {
  directives: ParsedDelegate[];
  duplicates: string[];
}

/**
 * Enumerates every `<delegate ...>` (paired or self-closing) directive
 * in the text. Attributes may be double- or single-quoted; quoted
 * values may contain ANY character (including `>`, `<`, newlines, AND
 * embedded quotes — see below) so model-emitted shell snippets like
 * `task="... git log --pretty=format:'%H%n%an <%ae>...'"` and prose
 * snippets like `task="...category: str = \"other\" is shadowed..."`
 * are both handled correctly.
 *
 * Two historical regressions handled by the patterns below:
 *
 *   1. Embedded `<` / `>`: a naive `[^>]*` attribute matcher would
 *      prematurely terminate at the `>` inside `<%ae>`, leaking the
 *      directive tail into the user's rendered message.
 *   2. Embedded `"` (screenshots §1 / §2): a naive `"[^"]*"` matcher
 *      closes the value at the FIRST embedded `"`, fails the rest of
 *      the regex, and either returns zero delegates or a truncated
 *      `task` string while leaking the un-stripped envelope into
 *      visible chat. The model's prose attributes legitimately contain
 *      embedded quotes (`"system"`, `"user"`, `"other"`, …) which
 *      makes this the dominant failure mode.
 *
 * Both bugs are fixed by sharing the canonical attribute-list source
 * with `@shared/text/strip.ts` — `ATTR_LIST_SRC` there now uses a
 * lookahead-driven quote-aware value pattern. The same heuristic is
 * inlined into `ATTR_RE` here so attribute extraction agrees with the
 * tag-boundary detection. See `@shared/text/strip.ts` for the
 * full design notes on the lookahead.
 */
const TAG_CLOSE_OR_NEXT_ATTR = '\\s*(?:\\/?>|[\\w-]+\\s*=)';
const ATTR_VALUE_DBL =
  `"(?:[^"]|"(?!${TAG_CLOSE_OR_NEXT_ATTR}))*"`;
const ATTR_VALUE_SGL =
  `'(?:[^']|'(?!${TAG_CLOSE_OR_NEXT_ATTR}))*'`;
const ATTR_LIST_SRC =
  `(?:\\s+[\\w-]+\\s*=\\s*(?:${ATTR_VALUE_DBL}|${ATTR_VALUE_SGL}))*\\s*`;
const DELEGATE_RE = new RegExp(
  `<delegate\\b(${ATTR_LIST_SRC})/?>`,
  'gi'
);
/**
 * Matches a single `name="value"` or `name='value'` attribute,
 * capturing the name in group 1, the double-quoted value (if any) in
 * group 2, and the single-quoted value (if any) in group 3. The
 * value patterns are quote-aware (same lookahead heuristic as
 * `ATTR_LIST_SRC`) so embedded quotes inside `task=` are preserved.
 */
const ATTR_RE = new RegExp(
  '([\\w-]+)\\s*=\\s*' +
  `(?:"((?:[^"]|"(?!${TAG_CLOSE_OR_NEXT_ATTR}))*)"|` +
  `'((?:[^']|'(?!${TAG_CLOSE_OR_NEXT_ATTR}))*)')`,
  'g'
);

export function parseDelegates(text: string): ParsedDelegate[] {
  return parseDelegatesWithDuplicates(text).directives;
}

/**
 * Same parsing semantics as `parseDelegates`, but ALSO surfaces every
 * directive that was dropped by the per-turn id-dedup. Callers that
 * want to emit a user-visible signal ("the model emitted two
 * `<delegate id="A1" …/>` in the same turn; only the first ran") use
 * this form. The plain `parseDelegates(text)` keeps the historical
 * "directives only" shape for callers that don't care.
 */
export function parseDelegatesWithDuplicates(text: string): ParseDelegatesResult {
  const found: ParsedDelegate[] = [];
  const duplicates: string[] = [];
  // Per-turn id dedupe. Two `<delegate id="A1" …/>` in the same
  // assistant turn used to spawn two parallel sub-agents that BOTH
  // emitted timeline events under `subagentId: 'A1'`; the renderer
  // reducer then collapsed them into a single `SubAgentSnapshot`,
  // silently losing one run's output + status. First occurrence
  // wins so the model's earliest (usually most intentional) directive
  // is the one that gets executed. The 2nd, 3rd, … occurrences land
  // in `duplicates` so the call site can surface the drop instead of
  // discarding it silently (review finding B1).
  const seenIds = new Set<string>();
  let m: RegExpExecArray | null;
  DELEGATE_RE.lastIndex = 0;
  while ((m = DELEGATE_RE.exec(text)) !== null) {
    const attrs: Record<string, string> = {};
    let am: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((am = ATTR_RE.exec(m[1] ?? '')) !== null) {
      // Group 2 is the double-quoted value, group 3 is the single-quoted
      // value. Exactly one of the two is defined per match.
      attrs[am[1]!.toLowerCase()] = am[2] ?? am[3] ?? '';
    }
    // Both `id` and `task` are required AND must be non-empty after
    // trimming. An empty-string attribute (`id=""`) is already rejected
    // by the truthiness check, but the old code accepted whitespace-only
    // values like `id="   "`, which would collide with any other
    // whitespace-only id in the same round and confuse `SubAgentPool`'s
    // dedup. Trim first, reject on empty.
    const idTrim = (attrs['id'] ?? '').trim();
    const taskTrim = (attrs['task'] ?? '').trim();
    if (!idTrim || !taskTrim) continue;
    if (seenIds.has(idTrim)) {
      duplicates.push(idTrim);
      continue;
    }
    seenIds.add(idTrim);
    found.push({
      id: idTrim,
      task: taskTrim,
      files: (attrs['files'] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      tools: (attrs['tools'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    });
  }
  return { directives: found, duplicates };
}

/**
 * Strips delegate directives from a text so we don't echo them back.
 * Re-exports the shared implementation from `@shared/text/strip`; both the
 * main process and the renderer pull the same primitives so the regex
 * cannot drift across the trust boundary.
 */
export { stripDelegateMarkup as stripDelegates } from '@shared/text/strip.js';
