import { describe, expect, it } from 'vitest';
import { chunkText } from '@main/memory/vector/chunkText';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    expect(chunkText('hello')).toEqual(['hello']);
  });

  it('splits long text into multiple overlapping chunks', () => {
    const body = 'word '.repeat(400).trim();
    const chunks = chunkText(body, 200, 40);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
  });
});
