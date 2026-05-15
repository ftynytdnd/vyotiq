/**
 * `detectAtToken` is the parser behind the Composer's `@`-mention
 * trigger. The whole UX hinges on it firing on `@`, `@s`, `@src/main`
 * etc. while NOT firing inside email addresses or other contexts where
 * `@` is preceded by a non-whitespace character.
 */

import { describe, expect, it } from 'vitest';
import { detectAtToken } from '@renderer/components/composer/atToken';

describe('detectAtToken', () => {
  it('returns null for empty input', () => {
    expect(detectAtToken('', 0)).toBeNull();
  });

  it('returns null when there is no @ before the cursor', () => {
    expect(detectAtToken('hello world', 5)).toBeNull();
  });

  it('triggers on a bare @ at start of input', () => {
    const out = detectAtToken('@', 1);
    expect(out).toEqual({ start: 0, query: '' });
  });

  it('triggers on @ following whitespace', () => {
    const out = detectAtToken('hello @s', 8);
    expect(out).toEqual({ start: 6, query: 's' });
  });

  it('extends the query as the user types more chars', () => {
    const out = detectAtToken('open @src/main', 14);
    expect(out).toEqual({ start: 5, query: 'src/main' });
  });

  it('does NOT trigger inside an email address', () => {
    expect(detectAtToken('mail me at user@example.com', 27)).toBeNull();
  });

  it('does NOT trigger when @ is preceded by a non-whitespace char', () => {
    expect(detectAtToken('foo@bar', 7)).toBeNull();
  });

  it('returns null when whitespace appears between @ and cursor', () => {
    // Whitespace between `@` and the cursor closes the token.
    expect(detectAtToken('hello @ world', 13)).toBeNull();
  });

  it('handles cursor in the middle of an existing token', () => {
    // Text: "hello @sr|c"  (cursor between r and c)
    const out = detectAtToken('hello @src', 9);
    expect(out).toEqual({ start: 6, query: 'sr' });
  });

  it('triggers on @ at start of input followed by chars', () => {
    const out = detectAtToken('@todo', 5);
    expect(out).toEqual({ start: 0, query: 'todo' });
  });

  it('keeps path-like characters (slash, dot, dash, underscore) inside the token', () => {
    const out = detectAtToken('add @src/components/foo-bar.test.ts', 35);
    expect(out?.query).toBe('src/components/foo-bar.test.ts');
  });
});
