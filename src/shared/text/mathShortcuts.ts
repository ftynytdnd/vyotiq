/**
 * Display-side normalization for the LaTeX-style math shortcuts that
 * frontier models occasionally emit when they want a typographic
 * symbol (an arrow, a comparison operator) but don't know whether
 * the rendering surface supports LaTeX.
 *
 * The app intentionally does NOT ship a full LaTeX renderer
 * (`remark-math` + `KaTeX` would add ~250 KB to the renderer bundle
 * for symbols the model uses a handful of times a day). Instead we
 * translate the small, well-bounded set of shortcuts the model
 * actually reaches for into their Unicode equivalents — covering the
 * common cases (pipeline arrows like
 * `AIProvider $\rightarrow$ NLHarness`, comparisons like `n $\le$ 5`,
 * operators like `$\pm$`, set notation, etc.) — while letting any
 * unknown command pass through untouched so a real math user still
 * sees their raw LaTeX (no silently-broken output).
 *
 * The shortcut table is anchored by literal `$` delimiters on both
 * sides so a stray backslash in user-quoted code (e.g. inside a
 * fenced ``` block) is never misinterpreted. Stripping fenced regions
 * before display is the caller's responsibility (e.g. `MarkdownBody`
 * runs the renderer pass against the same text, where fences mask
 * themselves out naturally during tokenization).
 *
 * Pure / no side effects — safe to call on every render and inside
 * `useMemo` selectors.
 */

/**
 * `[regex, glyph]` table. The regexes use a literal `$` delimiter on
 * each side and an `\` escape (`\\`) for the leading LaTeX command
 * backslash. A single `g` flag matches every occurrence in the input.
 *
 * Ordering note: longer / more specific commands FIRST when prefixes
 * collide (e.g. `\Leftrightarrow` MUST come before `\Leftarrow`)
 * because `String.replace` walks the table top-to-bottom. None of
 * the current entries actually collide — they all terminate at the
 * required trailing `$` — but the convention is preserved for
 * future additions.
 */
const SHORTCUTS: ReadonlyArray<readonly [RegExp, string]> = [
  // Arrows — pipeline notation (`A $\rightarrow$ B $\rightarrow$ C`)
  // is the dominant shortcut by an order of magnitude across the
  // observed corpus of orchestrator-emitted prose.
  [/\$\\(?:rightarrow|to)\$/g, '→'],
  [/\$\\(?:leftarrow|gets)\$/g, '←'],
  [/\$\\Rightarrow\$/g, '⇒'],
  [/\$\\Leftarrow\$/g, '⇐'],
  [/\$\\Leftrightarrow\$/g, '⇔'],
  [/\$\\leftrightarrow\$/g, '↔'],
  [/\$\\mapsto\$/g, '↦'],
  [/\$\\uparrow\$/g, '↑'],
  [/\$\\downarrow\$/g, '↓'],

  // Comparison / equality
  [/\$\\(?:le|leq)\$/g, '≤'],
  [/\$\\(?:ge|geq)\$/g, '≥'],
  [/\$\\(?:ne|neq)\$/g, '≠'],
  [/\$\\approx\$/g, '≈'],
  [/\$\\equiv\$/g, '≡'],

  // Arithmetic operators
  [/\$\\pm\$/g, '±'],
  [/\$\\mp\$/g, '∓'],
  [/\$\\times\$/g, '×'],
  [/\$\\cdot\$/g, '·'],
  [/\$\\div\$/g, '÷'],

  // Set theory (occasionally surfaces in scope / dependency prose)
  [/\$\\subseteq\$/g, '⊆'],
  [/\$\\supseteq\$/g, '⊇'],
  [/\$\\subset\$/g, '⊂'],
  [/\$\\supset\$/g, '⊃'],
  [/\$\\in\$/g, '∈'],
  [/\$\\notin\$/g, '∉'],
  [/\$\\cup\$/g, '∪'],
  [/\$\\cap\$/g, '∩'],
  [/\$\\emptyset\$/g, '∅'],

  // Common standalone symbols
  [/\$\\infty\$/g, '∞'],
  [/\$\\sum\$/g, '∑'],
  [/\$\\prod\$/g, '∏'],
  [/\$\\sqrt\$/g, '√'],
  [/\$\\ldots\$/g, '…'],
  [/\$\\cdots\$/g, '⋯']
];

/**
 * Replace every supported LaTeX-style shortcut in `text` with its
 * Unicode equivalent. Unrecognized commands pass through unchanged
 * — callers can rely on this to be lossless for non-shortcut input.
 *
 * No-op fast path: the helper bails immediately on inputs that don't
 * contain a literal `$\` (the prefix of every shortcut), so the
 * common case of plain prose pays the cost of one `indexOf` call.
 */
export function normalizeMathShortcuts(text: string): string {
  if (text.indexOf('$\\') === -1) return text;
  let out = text;
  for (const [re, glyph] of SHORTCUTS) {
    out = out.replace(re, glyph);
  }
  return out;
}
