/**
 * Title sanitization for auto-derived conversation titles.
 *
 * The first user prompt is used to seed the conversation's sidebar title.
 * Without sanitization, prompts like "## Launch multiple agents for X" land
 * in the sidebar with the literal `##` prefix, which looks broken and
 * mismatches the rest of the stealth UI. This module strips the common
 * markdown decorations a user would naturally include and collapses
 * whitespace so titles render as plain prose.
 *
 * Pure / dependency-free. Used by `conversationStore.deriveTitleIfFresh`
 * and exercised by a unit test next to it.
 */

const MAX_LEN = 60;

/** Leading-line markdown markers we strip before slicing. */
const LEADING_MARKERS = [
  /^\s*#{1,6}\s+/,            // ATX headings: #, ##, …
  /^\s*>\s+/,                 // blockquote
  /^\s*[-*+]\s+/,             // unordered list
  /^\s*\d+[.)]\s+/,           // ordered list (1. or 1))
  /^\s*```[\w-]*\s*/,         // fence open
  /^\s*~~~[\w-]*\s*/          // alt fence open
];

/** Inline marks that wrap text with no semantic content for a title. */
function stripInline(s: string): string {
  return s
    // Bold/italic markers wrapping text — keep the inner text only. We
    // run greedy strip across **…**, __…__, *…*, _…_, `…`.
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_(?!_)([^_\n]+)_(?!_)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    // Markdown links: [label](url) → label.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/**
 * Sanitize a raw user prompt into a clean sidebar title.
 *
 * Behavior:
 *   - Operates on the FIRST non-empty line (a prompt that opens with
 *     "## …\n\nbody" titles as the heading, not the body).
 *   - Strips leading markdown markers iteratively (e.g. "> ## title").
 *   - Strips inline markdown decorations (bold/italic/code/links).
 *   - Collapses internal whitespace.
 *   - Slices to MAX_LEN with an ellipsis when truncated.
 *
 * Returns an empty string if the input contains no usable text.
 */
export function sanitizeTitle(raw: string): string {
  if (!raw) return '';
  // Walk non-empty lines until we find one that yields content after
  // marker stripping. This handles inputs like "```\nbody\n```" where
  // the first non-empty line is a fence opener that collapses to empty.
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return '';

  for (const candidate of lines) {
    let line = candidate;
    // Iteratively strip leading markers ("> ## foo", "1. **foo**", …).
    // Hard cap on iterations defends against pathological patterns.
    for (let i = 0; i < 6; i++) {
      let stripped = line;
      for (const re of LEADING_MARKERS) {
        stripped = stripped.replace(re, '');
      }
      if (stripped === line) break;
      line = stripped;
    }
    line = stripInline(line);
    line = line.replace(/\s+/g, ' ').trim();
    if (line.length === 0) continue;
    if (line.length > MAX_LEN) return line.slice(0, MAX_LEN - 1) + '…';
    return line;
  }
  return '';
}
