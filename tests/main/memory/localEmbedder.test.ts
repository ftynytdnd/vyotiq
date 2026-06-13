import { describe, expect, it } from 'vitest';
import { embedLocal } from '@main/memory/embedding/localEmbedder';
import { VECTOR_EMBED_DIM } from '@shared/memory/vectorConstants';

describe('embedLocal', () => {
  it('returns a unit vector with the configured dimension', () => {
    const a = embedLocal('hello world test');
    expect(a.length).toBe(VECTOR_EMBED_DIM);
    let norm = 0;
    for (let i = 0; i < a.length; i++) {
      norm += a[i]! * a[i]!;
    }
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic for the same input', () => {
    const a = embedLocal('vyotiq vector memory');
    const b = embedLocal('vyotiq vector memory');
    expect([...a]).toEqual([...b]);
  });

  it('differs for different inputs', () => {
    const a = embedLocal('alpha beta gamma');
    const b = embedLocal('completely different topic');
    const same = [...a].every((v, i) => v === b[i]);
    expect(same).toBe(false);
  });
});
