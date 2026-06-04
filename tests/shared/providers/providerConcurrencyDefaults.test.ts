import { describe, expect, it } from 'vitest';
import { defaultMaxConcurrentStreamsForDialect } from '@shared/providers/providerConcurrencyDefaults.js';

describe('defaultMaxConcurrentStreamsForDialect', () => {
  it('returns dialect-specific defaults', () => {
    expect(defaultMaxConcurrentStreamsForDialect('openai')).toBe(32);
    expect(defaultMaxConcurrentStreamsForDialect('anthropic-native')).toBe(16);
    expect(defaultMaxConcurrentStreamsForDialect('ollama-native')).toBe(8);
  });

  it('treats undefined as openai', () => {
    expect(defaultMaxConcurrentStreamsForDialect(undefined)).toBe(32);
  });
});
