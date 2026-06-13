import { describe, expect, it } from 'vitest';
import {
  dialectHintFromHostname,
  modelsDevProviderId,
  parseProviderHostname
} from '@shared/providers/providerHostname.js';

describe('parseProviderHostname', () => {
  it('classifies known direct hosts', () => {
    expect(parseProviderHostname('https://integrate.api.nvidia.com').nvidia).toBe(true);
    expect(parseProviderHostname('https://openrouter.ai/api').openrouter).toBe(true);
    expect(parseProviderHostname('https://api.deepseek.com').deepseek).toBe(true);
  });

  it('maps dialect hints for canonical hosts', () => {
    expect(dialectHintFromHostname('https://api.anthropic.com')).toBe('anthropic-native');
    expect(dialectHintFromHostname('https://generativelanguage.googleapis.com')).toBe('gemini-native');
    expect(dialectHintFromHostname('https://ollama.com')).toBe('ollama-native');
    expect(dialectHintFromHostname('https://api.openai.com')).toBeNull();
  });

  it('maps models.dev provider buckets', () => {
    expect(modelsDevProviderId('https://integrate.api.nvidia.com')).toBe('nvidia');
    expect(modelsDevProviderId('https://api.groq.com/openai')).toBe('groq');
  });
});
