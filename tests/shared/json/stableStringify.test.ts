import { describe, expect, it } from 'vitest';
import { stableStringify } from '@shared/json/stableStringify';

describe('stableStringify', () => {
  it('sorts object keys deterministically', () => {
    const a = stableStringify({ b: 2, a: 1, c: { z: 1, y: 2 } });
    const b = stableStringify({ c: { y: 2, z: 1 }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2,"c":{"y":2,"z":1}}');
  });

  it('preserves array order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });
});
