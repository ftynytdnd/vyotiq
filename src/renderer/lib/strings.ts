/**
 * String helpers shared across the renderer.
 */

/** Walk `s` via newline boundaries and return at most `max` lines. */
export function splitLinesUpTo(s: string, max: number): string[] {
  if (max <= 0) return [];
  const out: string[] = [];
  let start = 0;
  while (out.length < max) {
    const nl = s.indexOf('\n', start);
    if (nl === -1) {
      out.push(s.slice(start));
      break;
    }
    out.push(s.slice(start, nl));
    start = nl + 1;
  }
  return out;
}

/** Count newline-delimited lines without materialising the full array. */
export function countLines(s: string): number {
  if (s.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') count++;
  }
  return count;
}
