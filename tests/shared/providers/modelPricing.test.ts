import { describe, expect, it } from 'vitest';
import {
  formatModelPricingBadge,
  parseModelPricingFromRow,
  usdPerTokenToPerMillion
} from '@shared/providers/modelPricing.js';

describe('modelPricing', () => {
  it('converts OpenRouter per-token pricing to per-million', () => {
    expect(usdPerTokenToPerMillion('0.0000025')).toBeCloseTo(2.5, 4);
    expect(usdPerTokenToPerMillion('0.00001')).toBeCloseTo(10, 4);
  });

  it('parses OpenRouter model row pricing', () => {
    const pricing = parseModelPricingFromRow({
      id: 'openai/gpt-4o',
      pricing: { prompt: '0.0000025', completion: '0.00001' }
    });
    expect(pricing?.inputPerMillion).toBeCloseTo(2.5, 4);
    expect(pricing?.outputPerMillion).toBeCloseTo(10, 4);
    expect(formatModelPricingBadge(pricing)).toBe('$2.50/$10.0');
  });
});
