/**
 * Pure-function helpers for the Composer's `/` skill slash trigger.
 *
 * Mirrors `atToken.ts`:
 *   - `/` at start or after whitespace triggers the skill picker.
 *   - Token extends from `/` to cursor, ending at first whitespace.
 */

export interface SlashToken {
  /** Index of the leading `/` character within the input string. */
  start: number;
  /** Substring strictly between `/` and the cursor. May be empty. */
  query: string;
}

export function detectSlashToken(value: string, cursor: number): SlashToken | null {
  let i = cursor;
  while (i > 0) {
    const ch = value[i - 1]!;
    if (ch === '/') {
      const prevCh = i - 2 >= 0 ? value[i - 2] : '';
      if (i - 2 < 0 || /\s/.test(prevCh ?? '')) {
        return { start: i - 1, query: value.slice(i, cursor) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}
