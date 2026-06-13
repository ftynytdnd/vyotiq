import { describe, expect, it } from 'vitest';
import { modelsFingerprint } from '@shared/providers/modelsFingerprint.js';
import type { ModelInfo } from '@shared/types/provider.js';

describe('modelsFingerprint', () => {
  it('changes when pricing is added', () => {
    const base: ModelInfo[] = [{ id: 'gpt-4o' }];
    const withPricing: ModelInfo[] = [
      { id: 'gpt-4o', pricing: { inputPerMillion: 3, outputPerMillion: 12 } }
    ];
    expect(modelsFingerprint(base)).not.toBe(modelsFingerprint(withPricing));
  });

  it('changes when contextEstimated flips', () => {
    const authoritative: ModelInfo[] = [{ id: 'qwen-128k', contextWindow: 128_000 }];
    const estimated: ModelInfo[] = [
      { id: 'qwen-128k', contextWindow: 128_000, contextEstimated: true }
    ];
    expect(modelsFingerprint(authoritative)).not.toBe(modelsFingerprint(estimated));
  });
});
