import { describe, expect, it } from 'vitest';
import {
  supportsParallelToolCalls,
  supportsToolChoice
} from '@main/providers/capabilities.js';

const deepSeekCaps = {
  supported: true,
  wireStyle: 'openai-deepseek' as const,
  rejectsToolChoice: true,
  defaultOn: true
};

describe('supportsParallelToolCalls', () => {
  it('is true for openai and anthropic dialects', () => {
    expect(supportsParallelToolCalls('openai')).toBe(true);
    expect(supportsParallelToolCalls('anthropic-native')).toBe(true);
  });

  it('is false for gemini and ollama dialects', () => {
    expect(supportsParallelToolCalls('gemini-native')).toBe(false);
    expect(supportsParallelToolCalls('ollama-native')).toBe(false);
  });
});

describe('supportsToolChoice', () => {
  it('returns false for DeepSeek thinking models while thinking is active', () => {
    expect(supportsToolChoice('openai', 'deepseek-v4-flash', undefined, deepSeekCaps)).toBe(
      false
    );
    expect(supportsToolChoice('openai', 'deepseek-v4-pro', 'high', deepSeekCaps)).toBe(false);
  });

  it('returns true when DeepSeek thinking is explicitly off', () => {
    expect(supportsToolChoice('openai', 'deepseek-v4-flash', 'off', deepSeekCaps)).toBe(true);
  });

  it('returns true for models without rejectsToolChoice metadata', () => {
    expect(supportsToolChoice('openai', 'gpt-5.3', 'high')).toBe(true);
    expect(supportsToolChoice('anthropic-native', 'claude-opus-4-7', 'high')).toBe(true);
    expect(supportsToolChoice('gemini-native', 'gemini-3-pro', 'high')).toBe(true);
    expect(supportsToolChoice('ollama-native', 'qwen3', 'high')).toBe(true);
    expect(supportsToolChoice(undefined, 'whatever', undefined)).toBe(true);
  });
});
