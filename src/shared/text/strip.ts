/**
 * Shared helpers for stripping orchestration-only XML directives out of
 * assistant text. `displayAssistantTurnText` and
 * `stripDelegatesForDisplay` both import from here so main and renderer
 * markup, but they live on opposite sides of the IPC boundary and cannot
 * import each other. This module is the single source of truth — both
 * sides import the regex constants and the pure helpers here.
 *
 * Coverage is intentionally broader than just `<delegate>`: the model can
 * (and occasionally does) emit other orchestration-shaped envelopes —
 * `<run_state>`, `<tool_calls>`, `<result>`, `<task>`, and bare
 * `</| DSML | tool_calls>`-style markers it invents — which would
 * otherwise leak into the rendered timeline as visible garbage (see
 * screenshots). Stripping is done via an explicit allowlist so we never
 * touch user-quoted code (`<template>`, `std::vector<int>`, etc.).
 *
 * Robustness note: a naive `[^>]*` attribute matcher breaks when an
 * attribute VALUE itself contains `>` or `<` — which happens routinely
 * with model-emitted tasks like
 * `task="... git log --pretty=format:'%H%n%an <%ae>...'"`. The `<%ae>`
 * email specifier would prematurely close the tag, leaving the tail
 * (`...>..." files="" />`) as visible garbage in the rendered message.
 * The patterns below use an explicit attribute-list sub-pattern that
 * allows `>` and `<` ONLY inside quoted attribute values; both `"..."`
 * and `'...'` forms are supported.
 *
 * The trailing `STRIP_PARTIAL_ORCH_RE` is deliberately permissive so a
 * buffer that ends mid-tag (`<delegate id="A1"`) does not flash raw XML
 * into the timeline during streaming.
 *
 * Display-mode invariant: fenced markdown code blocks (``` ... ``` and
 * `~~~ ... ~~~`) are MASKED before stripping and restored verbatim, so
 * a user asking the model to quote a literal `<delegate>` tag inside a
 * code fence will see it untouched. Outside code fences, ReactMarkdown
 * is configured WITHOUT `rehype-raw`, so any unknown XML-like tag the
 * model invents is already rendered as visible text by the GFM
 * tokenizer — that is the escape-fallback for unknown tags.
 */

/**
 * Quote-aware fragment for a single attribute VALUE — `"..."` or
 * `'...'` — that tolerates embedded quotes inside the value.
 *
 * Why we need quote-tolerance: the model's `task="…"` attribute is
 * free-form prose that legitimately quotes Python / shell / JSON
 * literals (`category: str = "other"`, `role == "system"`, `git log
 * --pretty=format:"%H"`, …). The previous `[^"]*` pattern closed the
 * value at the FIRST embedded `"`, leaving the rest of the tag as
 * un-stripped garbage in the user-facing prose (screenshots §1 / §2
 * — full multi-paragraph `<delegate />` envelopes rendered verbatim
 * in chat). Older parsers had the same bug and would truncate `task`
 * attribute values at embedded quotes.
 *
 * The fix is a negative lookahead on the closing quote: a `"` (or
 * `'`) inside a value is treated as the real CLOSING quote ONLY IF
 * it is followed (after optional whitespace) by tag-close syntax
 * (`>` or `/>`) or the start of the next attribute (`name=`). Any
 * other lookahead is embedded prose and the scan continues. This
 * has zero false-positives in practice because well-formed
 * orchestration tags are always closed with one of those two
 * structural sentinels.
 *
 * The body inner pattern is the alternation
 *
 *   `[^"]            — any non-quote char  |  "(?!{TAG_CLOSE})`     — a quote that isn't the structural closer
 *
 * which lets us walk past `"other"`, `"system"`, etc. while still
 * terminating cleanly at the actual end-of-value quote. Performance
 * stays dominated by the `[^"]` branch (the rare-quote alternative
 * fires only on each embedded quote, with a bounded lookahead).
 *
 * Performance / safety:
 *   - The lookahead matches `\s*` (greedy), then a constant alternative
 *     with a bounded `[\w-]+`. No nested quantifiers, no catastrophic
 *     backtracking risk.
 *   - The whole pattern is composed once at module load and reused
 *     across every directive-level regex below, so the cost is the
 *     same as the original implementation.
 */
const TAG_CLOSE_OR_NEXT_ATTR = '\\s*(?:\\/?>|[\\w-]+\\s*=)';
const ATTR_VALUE_DBL_SRC =
  `"(?:[^"]|"(?!${TAG_CLOSE_OR_NEXT_ATTR}))*"`;
const ATTR_VALUE_SGL_SRC =
  `'(?:[^']|'(?!${TAG_CLOSE_OR_NEXT_ATTR}))*'`;
const ATTR_VALUE_SRC = `(?:${ATTR_VALUE_DBL_SRC}|${ATTR_VALUE_SGL_SRC})`;

/**
 * Fragment that matches a valid attribute list: zero or more
 * `name="value"` or `name='value'` pairs separated by whitespace, with
 * optional trailing whitespace. Inside the quoted value, embedded
 * quotes are tolerated via the lookahead heuristic in
 * `ATTR_VALUE_SRC` above. Kept as a raw-source string so it can be
 * composed into each directive-level pattern without redeclaring
 * quoting rules in three places.
 */
const ATTR_LIST_SRC = `(?:\\s+[\\w-]+\\s*=\\s*${ATTR_VALUE_SRC})*\\s*`;

/**
 * Allowlist of orchestration-internal tag names the model may emit but
 * the user must never see. The list is deliberately small and explicit
 * so a future architectural addition (a new envelope tag) is a one-line
 * change here, while unrelated tags (`<template>`, `<style>`, language
 * generics) are unaffected.
 *
 * `delegate` is legacy markup only — stripping here never affects tool
 * dispatch; Agent V is a solo agent with no worker spawn path.
 */
const ORCHESTRATION_TAG_NAMES = [
  'delegate',
  'result',
  'status',
  'task',
  'run_state',
  'tool_calls',
  'system_instructions',
  // Workspace-listing envelope built by `contextManager.refreshEnvelopes`
  // — the wrap is `<workspace_context>…</workspace_context>` (no
  // `current_` prefix). The pre-fix entry was `current_workspace_context`
  // which matches no actual `wrapXml(...)` call in the codebase, so a
  // model echoing the real envelope name in prose would slip past the
  // strip. See `contextManager.ts:269`.
  'workspace_context',
  'recent_memory',
  'meta_rules',
  'session_context',
  'prior_conversations',
  // Real-time host snapshot envelope (`buildHostEnvironmentXml`) —
  // injected on every iteration by `runLoop` between `<meta_rules>` and
  // `<workspace_context>`. Listed here so a model echoing the envelope
  // back in user-facing prose ("`<host_environment> now_utc: …`") is
  // stripped at render time, same defense-in-depth pattern as the other
  // envelope tags above.
  'host_environment',
  // Inline chain-of-thought wrappers some models emit when prompted to
  // reason but lacking a native `reasoning_content` channel (Qwen-3,
  // GPT-OSS, R1 distilled variants behind generic OpenAI-compat shims,
  // custom CoT prompt templates). The streaming
  // `InlineReasoningRouter` already reclassifies the bulk of these into
  // the reasoning panel — listing the tags here is defense-in-depth so
  // any residual leak from a non-streaming path or a partial tag at
  // exact end-of-stream is stripped before reaching the markdown
  // renderer.
  //
  // Mirror this list with `inlineReasoningRouter.OPENERS` whenever a
  // new variant is added so the streaming and display strips agree.
  'think',
  'thinking',
  'reasoning',
  'reflection'
] as const;

/** Joined alternation for the orchestration tag-name group. */
const ORCH_TAG_GROUP = `(?:${ORCHESTRATION_TAG_NAMES.join('|')})`;

/**
 * Paired form for any allowlisted orchestration tag. Non-greedy body so
 * stacked envelopes don't collapse into one giant match.
 */
const ORCH_PAIR_RE = new RegExp(
  `<${ORCH_TAG_GROUP}\\b${ATTR_LIST_SRC}>[\\s\\S]*?</${ORCH_TAG_GROUP}>`,
  'gi'
);

/** Self-closing form for any allowlisted orchestration tag. */
const ORCH_SELFCLOSE_RE = new RegExp(
  `<${ORCH_TAG_GROUP}\\b${ATTR_LIST_SRC}/?>`,
  'gi'
);

/**
 * Bare DSML-style envelope. The model sometimes invents these as ad-hoc
 * section dividers (`</| | DSML | | tool_calls>` is the canonical leak
 * from the screenshots). The signature is:
 *
 *   - opens with `<` or `</`
 *   - followed by a literal `|`
 *   - body contains AT LEAST ONE more `|` (the DSML pipe-rail)
 *   - closes with `>`
 *
 * Requiring two pipes is the false-positive guard: a stray `<|x>` could
 * conceivably appear in user prose, but `<|...|...>` essentially never
 * does outside of orchestration scaffolding.
 *
 * Body characters exclude `<`, `>`, and newlines so we can't gobble
 * across structural boundaries. Cap the inside body at a generous but
 * finite length so a malformed stream can't catastrophic-backtrack the
 * regex engine.
 */
const BARE_ENVELOPE_RE = /<\/?\|[^<>\n]{0,200}\|[^<>\n]{0,200}>/g;

/**
 * Trailing partial of ANY allowlisted orchestration tag at the END of
 * the buffer. `[^<]*` anchors at the next opening bracket so we never
 * gobble unrelated content earlier in the buffer — by design this
 * matches ONLY up to the first `<` that could start an embedded tag.
 * That means a mid-stream partial `<delegate task="... <%ae` correctly
 * strips only the tail back to the embedded `<%ae` token; the fully
 * formed directive (once it arrives) is handled by the stricter
 * directive-level patterns above.
 */
const STRIP_PARTIAL_ORCH_RE = new RegExp(
  `<\\/?${ORCH_TAG_GROUP}\\b[^<]*$`,
  'i'
);

/** Trailing partial of a bare DSML envelope (e.g. `</| | DSML`). */
const STRIP_PARTIAL_ENVELOPE_RE = /<\/?\|[^<>\n]{0,200}$/;

/** Collapse runs of 3+ blank lines down to a paragraph break. */
const COLLAPSE_BLANKLINES_RE = /\n{3,}/g;

/**
 * Sentinel placeholder used to mask fenced code blocks during stripping.
 * The leading NUL guarantees the marker can never appear in normal
 * model output — control chars don't survive the streaming JSON
 * encoding path. The closing NUL keeps the marker self-delimiting.
 */
const FENCE_SENTINEL_PREFIX = '\u0000__FENCE_';
const FENCE_SENTINEL_SUFFIX = '__\u0000';

/**
 * Match a fenced code block, both ``` and ~~~ flavors, with optional
 * info string. Non-greedy so adjacent fences don't merge.
 */
const FENCE_RE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;

/**
 * Match a fence and capture its inner body (between the opening info
 * line and the closing delimiter). Used by the display-mode strip to
 * detect fences whose body is exclusively orchestration scaffolding —
 * the orchestrator occasionally wraps its own `<delegate>` envelope
 * in a code fence and `withFencedRegionsMasked` would otherwise
 * preserve it verbatim, leaking raw XML into the user's view.
 *
 * Mirrors `FENCE_RE` exactly except the inner `[\s\S]*?` is now a
 * capture group; both must stay in lockstep so the masking pass and
 * the display-only drop pass see the same set of fences.
 */
const FENCE_BODY_RE = /(^|\n)(```|~~~)[^\n]*\n([\s\S]*?)\n\2(?=\n|$)/g;

/**
 * Mask every fenced code block in `text` with a sentinel, run `fn` on
 * the masked body, then restore the fences verbatim. Guarantees no
 * strip ever touches code-fence content — even if the model put a
 * literal `<delegate />` or `</| DSML |>` inside a fence (e.g. while
 * documenting the harness itself).
 */
function withFencedRegionsMasked(
  text: string,
  fn: (masked: string) => string
): string {
  const fences: string[] = [];
  const masked = text.replace(FENCE_RE, (match, leading: string) => {
    const idx = fences.length;
    fences.push(match.startsWith('\n') ? match.slice(1) : match);
    // Preserve the leading newline (if any) outside the sentinel so
    // surrounding paragraph spacing doesn't shift.
    const prefix = match.startsWith('\n') ? '\n' : leading;
    return `${prefix}${FENCE_SENTINEL_PREFIX}${idx}${FENCE_SENTINEL_SUFFIX}`;
  });
  const processed = fn(masked);
  return processed.replace(
    new RegExp(
      `${FENCE_SENTINEL_PREFIX.replace(/\u0000/g, '\\u0000')}(\\d+)${FENCE_SENTINEL_SUFFIX.replace(/\u0000/g, '\\u0000')}`,
      'g'
    ),
    (_full, idx: string) => fences[Number(idx)] ?? ''
  );
}

/**
 * Match a trailing OPEN fence (no closing delimiter yet). Mirrors
 * `FENCE_RE` exactly through the opener, then accepts any body
 * (including newlines) up to end-of-string with NO closing delimiter.
 * Capture group 1 is the leading `^|\n` so the replacement can
 * preserve paragraph spacing without re-anchoring. Capture group 3
 * is the body after the info-line (may be undefined when only the
 * opener has arrived).
 */
const TRAILING_OPEN_FENCE_RE = /(^|\n)(```|~~~)[^\n]*(?:\n([\s\S]*))?$/;

/**
 * Pre-pass for the display strip: drop any fenced code block whose body
 * is exclusively orchestration scaffolding. The orchestrator sometimes
 * wraps its own `<delegate>` envelope (or a stack of envelopes) in a
 * ``` fence; the standard mask-then-strip flow would otherwise preserve
 * those fences verbatim and leak raw XML into the rendered timeline
 * (see screenshots §2 / §3).
 *
 * Detection heuristic: take each fence body and run it through the
 * same orchestration strip the masked path uses. If the result trims
 * to empty, every character of the fence body was orchestration markup
 * → drop the entire fence (and any leading newline so the surrounding
 * paragraph spacing doesn't crater). Fences with ANY prose or
 * non-orchestration code stay untouched.
 *
 * Risk-managed by design:
 *   - Pure-orchestration fences are exactly the leak case; legitimate
 *     code examples in user prose contain real code, not allowlisted
 *     orchestration tags, and survive.
 *   - A user asking the model to quote a literal `<delegate />` inside
 *     a code fence with no other content is the one edge case where
 *     this strip removes the quoted example. That's an acceptable
 *     trade per the audit decision — the timeline cards still render
 *     the actual delegations.
 */
function dropOrchestrationOnlyFences(text: string): string {
  return text.replace(FENCE_BODY_RE, (match, leading: string, _delim: string, body: string) => {
    const stripped = body
      .replace(ORCH_PAIR_RE, '')
      .replace(ORCH_SELFCLOSE_RE, '')
      .replace(BARE_ENVELOPE_RE, '')
      .replace(STRIP_PARTIAL_ORCH_RE, '')
      .replace(STRIP_PARTIAL_ENVELOPE_RE, '')
      .trim();
    if (stripped.length === 0) {
      // Preserve the leading newline so paragraphs above/below don't
      // collide; the subsequent `COLLAPSE_BLANKLINES_RE` pass folds
      // any over-shoot back to a single paragraph break.
      return leading;
    }
    return match;
  });
}

/**
 * Renderer-facing strip used on streaming text deltas. Aggressively removes
 * orchestration markup — both the `<delegate>` family and the broader
 * `ORCHESTRATION_TAG_NAMES` allowlist — including any trailing partial
 * tag at the buffer tail, so the user never sees raw XML scaffolding
 * flash into the rendered timeline. Also collapses runs of blank lines
 * left behind by the strip so the rendered paragraph spacing stays
 * tight.
 *
 * Fenced code blocks are masked before stripping and restored verbatim
 * for normal cases. As a defense-in-depth layer, fences whose body is
 * exclusively orchestration scaffolding are dropped UP FRONT via
 * `dropOrchestrationOnlyFences` so a model that wraps its own
 * `<delegate>` envelope in ``` can't leak it to the user.
 *
 * Outside code fences, any unknown XML-like tag the model invents is
 * rendered as visible text by ReactMarkdown (no `rehype-raw` is
 * configured), so the escape-fallback is automatic.
 */
/**
 * Drop a trailing OPEN fence (no closing delimiter yet) from display text
 * when it would render as an empty gray `<pre>` pill. Orchestration markup
 * is stripped, not rendered.
 *
 * Illustration fences that still carry real prose/code mid-stream are
 * left intact so a closing delimiter can arrive on the next delta.
 */
function stripTrailingOpenFencesForDisplay(text: string): string {
  return text.replace(
    TRAILING_OPEN_FENCE_RE,
    (match, leading: string, _delim: string, body: string | undefined) => {
      if (typeof body !== 'string') return leading;

      const bodyAfterOrchStrip = body
        .replace(ORCH_PAIR_RE, '')
        .replace(ORCH_SELFCLOSE_RE, '')
        .replace(BARE_ENVELOPE_RE, '')
        .replace(STRIP_PARTIAL_ORCH_RE, '')
        .replace(STRIP_PARTIAL_ENVELOPE_RE, '')
        .trim();
      ORCH_PAIR_RE.lastIndex = 0;
      ORCH_SELFCLOSE_RE.lastIndex = 0;
      BARE_ENVELOPE_RE.lastIndex = 0;

      if (bodyAfterOrchStrip.length === 0) return leading;
      return match;
    }
  );
}

export function stripDelegatesForDisplay(text: string): string {
  const preStripped = dropOrchestrationOnlyFences(text);
  const stripped = withFencedRegionsMasked(preStripped, (masked) =>
    masked
      .replace(ORCH_PAIR_RE, '')
      .replace(ORCH_SELFCLOSE_RE, '')
      .replace(BARE_ENVELOPE_RE, '')
      .replace(STRIP_PARTIAL_ORCH_RE, '')
      .replace(STRIP_PARTIAL_ENVELOPE_RE, '')
      .replace(COLLAPSE_BLANKLINES_RE, '\n\n')
  ).trim();
  return stripTrailingOpenFencesForDisplay(stripped).trim();
}
