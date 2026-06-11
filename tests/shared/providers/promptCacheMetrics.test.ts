import { describe, expect, it } from 'vitest';
import { providerDialectReportsPromptCache } from '@shared/providers/promptCacheMetrics';
import { PROVIDER_DIALECTS } from '@shared/types/provider';

describe('providerDialectReportsPromptCache', () => {
  it('returns false for ollama-native (no wire cache fields)', () => {
    expect(providerDialectReportsPromptCache('ollama-native')).toBe(false);
  });

  it('returns true for cache-capable dialects', () => {
    expect(providerDialectReportsPromptCache('openai')).toBe(true);
    expect(providerDialectReportsPromptCache('anthropic-native')).toBe(true);
    expect(providerDialectReportsPromptCache('gemini-native')).toBe(true);
  });

  it('covers every ProviderDialect', () => {
    for (const dialect of PROVIDER_DIALECTS) {
      expect(typeof providerDialectReportsPromptCache(dialect)).toBe('boolean');
    }
  });
});
