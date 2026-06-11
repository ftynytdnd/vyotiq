import { describe, expect, it } from 'vitest';
import { lookupHostModelPricing } from '@shared/providers/hostModelPricing.js';

describe('hostModelPricing', () => {
  it('resolves OpenAI flagship pricing', () => {
    const p = lookupHostModelPricing('openai', 'gpt-5.4');
    expect(p?.inputPerMillion).toBe(2.5);
    expect(p?.outputPerMillion).toBe(15);
  });

  it('resolves DeepSeek chat pricing', () => {
    const p = lookupHostModelPricing('deepseek', 'deepseek-chat');
    expect(p?.inputPerMillion).toBe(0.27);
  });

  it('returns undefined for unknown models', () => {
    expect(lookupHostModelPricing('openai', 'unknown-model-xyz')).toBeUndefined();
  });

  it('resolves Gemini 3.x fallback pricing', () => {
    const p = lookupHostModelPricing('gemini', 'gemini-3.1-pro-preview');
    expect(p?.inputPerMillion).toBe(2);
    expect(p?.outputPerMillion).toBe(12);
  });

  it('resolves xAI grok fallback pricing', () => {
    const p = lookupHostModelPricing('xai', 'grok-3');
    expect(p?.inputPerMillion).toBe(2);
  });
});
