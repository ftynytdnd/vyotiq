import { describe, expect, it } from 'vitest';
import { lookupHostModelContext } from '@shared/providers/hostModelContext.js';

describe('lookupHostModelContext', () => {
  it('returns OpenAI GPT-5.5 context from curated table', () => {
    expect(lookupHostModelContext('openai', 'gpt-5.5')).toBe(1_050_000);
  });

  it('returns OpenAI GPT-4o context from curated table', () => {
    expect(lookupHostModelContext('openai', 'gpt-4o')).toBe(128_000);
  });

  it('strips vendor prefix before matching', () => {
    expect(lookupHostModelContext('openai', 'openai/gpt-4o')).toBe(128_000);
  });

  it('returns DeepSeek chat model context', () => {
    expect(lookupHostModelContext('deepseek', 'deepseek-chat')).toBe(1_000_000);
  });

  it('returns Groq llama context', () => {
    expect(lookupHostModelContext('groq', 'llama-3.3-70b-versatile')).toBe(131_072);
  });

  it('returns undefined for unknown generic hosts', () => {
    expect(lookupHostModelContext('generic', 'glm-5.1')).toBeUndefined();
  });
});
