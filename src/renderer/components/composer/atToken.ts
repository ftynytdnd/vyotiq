/**
 * Pure-function helpers for the Composer's `@`-mention trigger.
 *
 * Pulled out of `Composer.tsx` so the parser can be unit-tested
 * without spinning up the whole React tree. Behavior contract:
 *
 *   - The `@` must be at the start of the textarea or be preceded by
 *     whitespace, so `email@domain.com` does NOT trigger the picker.
 *   - The token extends from the `@` to the cursor, ending at the
 *     first whitespace character (path chars, dots, slashes, dashes,
 *     and underscores stay inside the token).
 *   - Returns `null` if the cursor is not currently inside a token.
 */

export interface AtToken {
  /** Index of the leading `@` character within the input string. */
  start: number;
  /** Substring strictly between the `@` and the cursor. May be empty. */
  query: string;
}

export function detectAtToken(value: string, cursor: number): AtToken | null {
  let i = cursor;
  while (i > 0) {
    const ch = value[i - 1]!;
    if (ch === '@') {
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
