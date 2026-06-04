/**
 * Helpers for the `edit` tool.
 *
 * These are extracted into a separate module so they can be unit-tested
 * independently of disk I/O and so the on-no-match diagnostic logic stays
 * legible inside the main tool handler.
 *
 * The hunk computation lives in `@shared/text/diff/computeDiffHunks` —
 * import it directly from there. A previous local re-export of
 * `computeDiffHunks` was removed (audit fix — May 2026); both
 * `edit.tool.ts` and `bash.tool.ts` now import the shared module
 * directly so there's exactly one indirection layer between the
 * tool handlers and the LCS implementation.
 */

const CR_RE = /\r\n/g;

/**
 * Matches each line of Vyotiq `read` tool output: optional leading spaces
 * (5-char line-number column), digits, tab, then file bytes.
 * Align with `read.tool.ts` (`padStart(5)` + `\t`).
 */
export const READ_TOOL_LINE_PREFIX_RE = /^\s*\d+\t/;

/**
 * Strip `read`-style line-number prefixes when every non-empty line has
 * one. Leaves the string unchanged if any line lacks the prefix so
 * legitimate `123\t…` TSV rows are not stripped unless the whole block
 * looks like pasted `read` output.
 */
export function stripReadLinePrefixesIfUniform(s: string): string {
  if (s.length === 0) return s;
  const trailingNl = s.endsWith('\n');
  const lines = s.split(/\r?\n/);
  const nonEmpty = lines.filter((line) => line.length > 0);
  if (nonEmpty.length === 0) return s;
  if (!nonEmpty.every((line) => READ_TOOL_LINE_PREFIX_RE.test(line))) return s;
  const stripped = lines.map((line) =>
    line.length === 0 ? line : line.replace(READ_TOOL_LINE_PREFIX_RE, '')
  );
  let out = stripped.join('\n');
  if (trailingNl && !out.endsWith('\n')) out += '\n';
  return out;
}

/** Normalize edit needles before flexible match (CRLF + read paste). */
export function normalizeEditNeedles(oldString: string, newString: string): {
  oldString: string;
  newString: string;
} {
  return {
    oldString: stripReadLinePrefixesIfUniform(oldString),
    newString: stripReadLinePrefixesIfUniform(newString)
  };
}

/** Cheap CRLF→LF normalization. Returns identity when no CR is present
 *  (avoids allocating for the LF-only fast path). */
function normalizeNewlines(s: string): string {
  return s.indexOf('\r') === -1 ? s : s.replace(CR_RE, '\n').replace(/\r/g, '\n');
}

/**
 * Try to find `oldString` in `original` with cross-EOL tolerance.
 *
 * Strategy:
 *   1. Direct exact match against the original buffer (no normalization).
 *   2. If that misses, normalize both sides to LF and search again. When
 *      we hit, translate the normalized index back into the original
 *      buffer's coordinate space so the caller can splice without
 *      disturbing the file's existing line endings.
 *
 * Returns:
 *   - `null` when the needle isn't present in either form.
 *   - `{ index, length, normalized }` where `index`/`length` are offsets
 *     into the ORIGINAL buffer ready for `String.prototype.slice` /
 *     splice. `normalized` is true if the match was via normalized
 *     comparison (caller may want to log this).
 */
export interface MatchResult {
  index: number;
  length: number;
  normalized: boolean;
}

export function findFlexible(original: string, needle: string): MatchResult | null {
  if (needle.length === 0) return null;
  const direct = original.indexOf(needle);
  if (direct !== -1) {
    return { index: direct, length: needle.length, normalized: false };
  }
  const origN = normalizeNewlines(original);
  const needleN = normalizeNewlines(needle);
  if (origN === original && needleN === needle) return null; // already pure LF, no help.
  const idxN = origN.indexOf(needleN);
  if (idxN === -1) return null;
  // Translate normalized offset back to the original by counting CRLFs
  // that appear before idxN. Each CRLF in the original collapses to one
  // LF in the normalized view, so we scan up to the equivalent point.
  let origIdx = 0;
  let normIdx = 0;
  while (normIdx < idxN && origIdx < original.length) {
    if (original[origIdx] === '\r' && original[origIdx + 1] === '\n') {
      origIdx += 2;
    } else if (original[origIdx] === '\r') {
      origIdx += 1;
    } else {
      origIdx += 1;
    }
    normIdx += 1;
  }
  // The matched span in the original may be longer than needle.length
  // when the needle contains LF-equivalents that are CRLF on disk. Walk
  // forward by needleN.length normalized chars to compute the original
  // span length.
  let endOrig = origIdx;
  let endNorm = 0;
  while (endNorm < needleN.length && endOrig < original.length) {
    if (original[endOrig] === '\r' && original[endOrig + 1] === '\n') {
      endOrig += 2;
    } else if (original[endOrig] === '\r') {
      endOrig += 1;
    } else {
      endOrig += 1;
    }
    endNorm += 1;
  }
  return { index: origIdx, length: endOrig - origIdx, normalized: true };
}

/** Count occurrences of `needle` in `haystack` using flexible (CRLF→LF)
 *  matching when the direct count is 0. */
export function countOccurrencesFlexible(haystack: string, needle: string): number {
  if (!needle) return 0;
  const direct = countDirect(haystack, needle);
  if (direct > 0) return direct;
  return countDirect(normalizeNewlines(haystack), normalizeNewlines(needle));
}

function countDirect(haystack: string, needle: string): number {
  let n = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    n++;
    idx += needle.length;
  }
  return n;
}

/**
 * Tokenize a string into lowercase word-ish tokens. Used by the no-match
 * diagnostic to score line similarity.
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1);
}

/**
 * Return the top-N lines from `original` most similar to `needle` (by
 * Jaccard token overlap). Used to give the model an actionable hint when
 * its `oldString` doesn't match.
 *
 * Lines are returned with their 1-indexed line number prefix in the
 * shape `"  42: <line content trimmed to 200 chars>"` to match what the
 * model already sees from the `read` tool.
 */
export function suggestSimilarLines(
  original: string,
  needle: string,
  topN = 3
): string[] {
  const lines = original.split('\n');
  const needleTokens = new Set(tokenize(needle));
  if (needleTokens.size === 0) return [];

  type Scored = { score: number; line: number; text: string };
  const scored: Scored[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineRaw = lines[i] ?? '';
    if (lineRaw.trim().length === 0) continue;
    const lt = new Set(tokenize(lineRaw));
    if (lt.size === 0) continue;
    let inter = 0;
    for (const t of needleTokens) if (lt.has(t)) inter += 1;
    if (inter === 0) continue;
    const union = needleTokens.size + lt.size - inter;
    const score = inter / union;
    scored.push({ score, line: i + 1, text: lineRaw.trim().slice(0, 200) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN).map((s) => `  ${s.line}: ${s.text}`);
}
