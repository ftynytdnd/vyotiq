import { describe, expect, it } from 'vitest';
import { splitLinesUpTo, countLines } from '@renderer/lib/strings.js';

describe('splitLinesUpTo', () => {
  it('returns at most max lines without allocating the full split array', () => {
    const big = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const lines = splitLinesUpTo(big, 3);
    expect(lines).toEqual(['line 0', 'line 1', 'line 2']);
  });

  it('returns the tail segment when fewer lines exist than max', () => {
    expect(splitLinesUpTo('a\nb', 5)).toEqual(['a', 'b']);
    expect(splitLinesUpTo('solo', 5)).toEqual(['solo']);
  });

  it('counts lines without materialising them', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('one')).toBe(1);
    expect(countLines('a\nb\nc')).toBe(3);
  });
});
