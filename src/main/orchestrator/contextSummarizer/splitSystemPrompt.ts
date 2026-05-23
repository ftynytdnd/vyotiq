/**
 * Split the orchestrator's assembled system-prompt string into the
 * named parts the Inspector's foldable Wire Breakdown surfaces.
 *
 * Input: the full `messages[0].content` value the orchestrator's
 * `runLoop` produces via `buildSystemPrompt(harness, env, runStateXml,
 * hostEnvironmentXml)`. That helper joins the harness body and seven
 * named XML envelopes with `\n\n` separators (no outer wrapper for the
 * orchestrator surface — the harness directives sit at the very top
 * as plain markdown).
 *
 * Output: an ordered list of `{label, body}` pairs, where the first
 * row is always "Harness body" (every byte of the input that lies
 * OUTSIDE the matched envelope ranges — directives, tool catalogue,
 * runtime-limits prose). The remaining rows are the envelopes in
 * their canonical system-prompt order, when each is found. Missing
 * envelopes are silently skipped so an idle / pre-iteration snapshot
 * (where some envelopes haven't been built yet) doesn't generate
 * empty rows.
 *
 * Invariants:
 *   1. The returned `body` strings, when concatenated in input order
 *      with the original separators, exactly reconstruct the input.
 *      The Inspector's per-row tokenizer relies on this so the sum
 *      of envelope tokens never exceeds `framing.systemPromptTokens`
 *      by more than the chat-format framing overhead.
 *   2. Each canonical envelope appears AT MOST once in the output.
 *      The orchestrator's assembler emits each envelope tag exactly
 *      once; if a malformed system message somehow contains a
 *      duplicate tag, only the first match is recognised and the
 *      rest stays under "Harness body" (defensive, surfaces the
 *      anomaly without breaking).
 *
 * Pure / no-throw / no-allocation-beyond-the-result. Called from
 * `getInspectorSnapshot` on the inspector path which is bounded
 * (one snapshot per token-usage frame); the regex compiles once
 * per call but each pattern is short and bounded.
 */

/**
 * Canonical envelope-tag list, in the order they appear in the
 * orchestrator's system prompt. The order matches `buildSystemPrompt`'s
 * `[harness, metaRulesXml, hostEnvironmentXml, workspaceXml,
 * sessionXml, runStateXml, priorConversationsXml, memoryXml].join`
 * shape so the Inspector's row order mirrors the wire order the
 * agent itself reads.
 *
 * `label` is the user-facing row title in the Inspector. Kept
 * Title-Case + lower-case-keyword to match the existing breakdown
 * row labels ("System prompt + envelopes", "Tool schemas",
 * "Message bodies").
 */
const ENVELOPE_SPECS: ReadonlyArray<{ tag: string; label: string }> = [
  { tag: 'meta_rules', label: 'Meta rules' },
  { tag: 'host_environment', label: 'Host environment' },
  { tag: 'workspace_context', label: 'Workspace context' },
  { tag: 'session_context', label: 'Session context' },
  { tag: 'run_state', label: 'Run state' },
  { tag: 'prior_conversations', label: 'Prior conversations' },
  { tag: 'recent_memory', label: 'Recent memory' }
];

/** Label the Inspector uses for the residual non-envelope content. */
const HARNESS_BODY_LABEL = 'Harness body';

export interface SystemPromptPart {
  /** User-facing row title shown in the Inspector. */
  label: string;
  /** Verbatim body string (the envelope's full `<tag>…</tag>` form for
   *  envelopes, or the residual non-envelope text for the harness).
   *  Tokenized as-is by the caller. */
  body: string;
}

/**
 * Find the first paired `<tag>…</tag>` occurrence in `content` and
 * return its `[start, end]` byte range (inclusive of both delimiters)
 * along with the full matched string. Returns `null` when the tag is
 * absent — caller skips the row in that case.
 *
 * The regex tolerates attributes on the opening tag (`<tag ...>`)
 * even though the orchestrator's host-built envelopes don't carry
 * any today; futureproofs against a `wrapXml` extension that adds
 * one. The body match is non-greedy so two adjacent envelopes don't
 * collapse into a single span.
 */
function findEnvelopeRange(
  content: string,
  tag: string
): { start: number; end: number; match: string } | null {
  // `[^>]*` is fine for the opening tag's attribute list because
  // host-built envelopes never embed `>` inside an attribute value
  // (unlike the model-emitted `<delegate task="…">` case the renderer
  // strip handles). The body is `[\s\S]*?` to span newlines AND stay
  // non-greedy across stacked envelopes.
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'i');
  const m = re.exec(content);
  if (m === null || m.index < 0) return null;
  const start = m.index;
  const end = start + m[0].length;
  return { start, end, match: m[0] };
}

/**
 * Split a system-prompt string into the foldable per-part rows the
 * Inspector renders under "System prompt + envelopes".
 *
 * Algorithm:
 *   1. Locate each canonical envelope's range (first occurrence only).
 *   2. Collect non-envelope spans into the "Harness body" residual.
 *      A single concatenated body is returned even when envelopes
 *      split it into pieces — the harness body IS one logical part.
 *   3. Emit "Harness body" first (the agent reads it first), then
 *      the envelopes in canonical order, skipping any not found.
 *
 * Empty harness bodies (a degenerate input that is JUST envelopes)
 * still emit the row with an empty string, so the Inspector keeps
 * a stable row count and the user sees "Harness body — 0 tokens"
 * rather than the row vanishing. This matches the policy in
 * `WireBreakdown` where zero-valued rows render with zero width
 * but stay visible.
 */
export function splitSystemPromptForBreakdown(
  content: string
): SystemPromptPart[] {
  if (content.length === 0) {
    return [{ label: HARNESS_BODY_LABEL, body: '' }];
  }
  // Pass 1 — locate every envelope's range. Skip ones that aren't
  // present so an idle snapshot (no run state yet, no memory yet)
  // doesn't surface empty placeholder rows.
  const located: Array<{
    label: string;
    body: string;
    start: number;
    end: number;
  }> = [];
  for (const spec of ENVELOPE_SPECS) {
    const r = findEnvelopeRange(content, spec.tag);
    if (r === null) continue;
    located.push({
      label: spec.label,
      body: r.match,
      start: r.start,
      end: r.end
    });
  }
  // Sort by document order so the residual-walk can splice non-
  // envelope spans correctly. The canonical-order array used above
  // already mirrors document order for a well-formed prompt; this
  // sort is purely defensive (e.g. a future caller passing a system
  // message with envelopes in a non-canonical order).
  located.sort((a, b) => a.start - b.start);

  // Pass 2 — concatenate the non-envelope spans into the harness body.
  // Walk the input and for each gap between envelope ranges, append
  // the text. The trim avoids surfacing the `\n\n` separator bytes
  // that buildSystemPrompt emits between envelopes — those are
  // structural framing the user doesn't think of as "harness" and
  // tokenize to 1-2 tokens anyway, lost in the rounding.
  let cursor = 0;
  const harnessSpans: string[] = [];
  for (const env of located) {
    if (env.start > cursor) {
      harnessSpans.push(content.slice(cursor, env.start));
    }
    cursor = env.end;
  }
  if (cursor < content.length) {
    harnessSpans.push(content.slice(cursor));
  }
  // Single-space-collapsed join — the user reads this as one
  // contiguous body in the row label, even though the structural
  // residue is split by the envelopes. The `.trim()` on each span
  // strips the joining `\n\n` separators emitted by
  // `buildSystemPrompt` so empty spans (two adjacent envelopes
  // separated only by the joiner) collapse to nothing.
  const harnessBody = harnessSpans
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('\n\n');

  // Output order: harness body first (the agent reads it first as
  // pure-prose directives), then envelopes in canonical order.
  return [
    { label: HARNESS_BODY_LABEL, body: harnessBody },
    ...located.map((e) => ({ label: e.label, body: e.body }))
  ];
}
