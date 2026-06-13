import { describe, expect, it } from 'vitest';
import { mergeModelPricing } from '@shared/providers/modelPricing.js';

describe('mergeModelPricing', () => {
  it('keeps provider-primary fields and fills gaps from fallback', () => {
    const merged = mergeModelPricing(
      { inputPerMillion: 3, outputPerMillion: 15 },
      {
        inputPerMillion: 99,
        outputPerMillion: 99,
        cachedInputPerMillion: 0.3,
        cacheWriteInputPerMillion: 3.75
      }
    );
    expect(merged?.inputPerMillion).toBe(3);
    expect(merged?.outputPerMillion).toBe(15);
    expect(merged?.cachedInputPerMillion).toBe(0.3);
    expect(merged?.cacheWriteInputPerMillion).toBe(3.75);
  });

  it('uses fallback when primary is missing', () => {
    const merged = mergeModelPricing(undefined, { inputPerMillion: 1, outputPerMillion: 2 });
    expect(merged?.inputPerMillion).toBe(1);
  });
});
