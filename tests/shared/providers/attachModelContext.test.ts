import { describe, expect, it } from 'vitest';
import { attachModelContext } from '@shared/providers/attachModelContext.js';
import type { ProviderWithKey } from '@shared/types/provider.js';

function provider(baseUrl: string): ProviderWithKey {
  return {
    id: 'p',
    name: 'Test',
    baseUrl,
    dialect: 'openai',
    enabled: true,
    models: [],
    apiKey: 'k'
  };
}

describe('attachModelContext', () => {
  it('returns discovered context without marking estimated', () => {
    expect(attachModelContext(provider('https://api.openai.com'), 'gpt-4o', 200_000)).toEqual({
      contextWindow: 200_000
    });
  });

  it('marks host-table fallback as estimated', () => {
    const result = attachModelContext(provider('https://api.openai.com'), 'gpt-4o');
    expect(result).toEqual({ contextWindow: 128_000, contextEstimated: true });
  });

  it('marks DeepSeek host default as estimated', () => {
    const result = attachModelContext(provider('https://api.deepseek.com'), 'deepseek-chat');
    expect(result).toEqual({ contextWindow: 1_000_000, contextEstimated: true });
  });

  it('returns empty when no source matches', () => {
    expect(attachModelContext(provider('https://example.com'), 'unknown-model')).toEqual({});
  });
});
