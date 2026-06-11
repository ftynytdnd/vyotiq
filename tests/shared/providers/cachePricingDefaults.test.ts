import { describe, expect, it } from 'vitest';
import {
  resolveCacheReadMultiplier,
  withPromptCachePricingDefaults
} from '@shared/providers/cachePricingDefaults.js';

describe('resolveCacheReadMultiplier', () => {
  it('uses 0.1× for GPT-5 and o-series on OpenAI', () => {
    expect(resolveCacheReadMultiplier('openai', 'gpt-5.2')).toBe(0.1);
    expect(resolveCacheReadMultiplier('openai', 'o3-mini')).toBe(0.1);
  });

  it('uses 0.25× for GPT-4.1 family', () => {
    expect(resolveCacheReadMultiplier('openai', 'gpt-4.1')).toBe(0.25);
    expect(resolveCacheReadMultiplier('openai', 'gpt-4.1-mini')).toBe(0.25);
  });

  it('uses 0.5× for GPT-4o family', () => {
    expect(resolveCacheReadMultiplier('openai', 'gpt-4o')).toBe(0.5);
    expect(resolveCacheReadMultiplier('openai', 'gpt-4o-mini')).toBe(0.5);
  });

  it('uses 0.25× implicit fallback for Gemini', () => {
    expect(resolveCacheReadMultiplier('gemini', 'gemini-2.5-pro')).toBe(0.25);
  });

  it('uses 0.1× for Anthropic and DeepSeek', () => {
    expect(resolveCacheReadMultiplier('anthropic', 'claude-sonnet-4-6')).toBe(0.1);
    expect(resolveCacheReadMultiplier('deepseek', 'deepseek-v4-flash')).toBe(0.1);
  });

  it('uses upstream-family multipliers for OpenRouter model ids', () => {
    expect(resolveCacheReadMultiplier('openrouter', 'anthropic/claude-sonnet-4')).toBe(0.1);
    expect(resolveCacheReadMultiplier('openrouter', 'google/gemini-2.5-pro')).toBe(0.25);
    expect(resolveCacheReadMultiplier('openrouter', 'openai/gpt-4o')).toBe(0.5);
  });
});

describe('withPromptCachePricingDefaults', () => {
  it('adds tiered cache read for GPT-4o on OpenAI hosts', () => {
    const out = withPromptCachePricingDefaults(
      'openai',
      { inputPerMillion: 2.5, outputPerMillion: 10 },
      'gpt-4o'
    );
    expect(out?.cachedInputPerMillion).toBeCloseTo(1.25, 6);
    expect(out?.cacheWriteInputPerMillion).toBeUndefined();
  });

  it('adds 0.1× cache read for GPT-5 on OpenAI hosts', () => {
    const out = withPromptCachePricingDefaults(
      'openai',
      { inputPerMillion: 5, outputPerMillion: 15 },
      'gpt-5.2'
    );
    expect(out?.cachedInputPerMillion).toBeCloseTo(0.5, 6);
  });

  it('adds cache write rate for Anthropic hosts', () => {
    const out = withPromptCachePricingDefaults(
      'anthropic',
      { inputPerMillion: 3, outputPerMillion: 15 },
      'claude-sonnet-4-6'
    );
    expect(out?.cachedInputPerMillion).toBeCloseTo(0.3, 6);
    expect(out?.cacheWriteInputPerMillion).toBeCloseTo(3.75, 6);
  });

  it('preserves explicit upstream cache pricing', () => {
    const out = withPromptCachePricingDefaults(
      'openai',
      {
        inputPerMillion: 5,
        outputPerMillion: 15,
        cachedInputPerMillion: 0.42
      },
      'gpt-5.2'
    );
    expect(out?.cachedInputPerMillion).toBe(0.42);
  });
});
