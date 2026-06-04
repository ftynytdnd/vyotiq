import { describe, expect, it } from 'vitest';
import {
  supportsParallelToolCalls,
  supportsToolChoice
} from '@main/providers/capabilities.js';

describe('supportsParallelToolCalls', () => {
  it('enables OpenAI-compat and Anthropic native wire flags', () => {
    expect(supportsParallelToolCalls('openai')).toBe(true);
    expect(supportsParallelToolCalls('anthropic-native')).toBe(true);
  });

  it('disables dialects without a parallel hint on the wire', () => {
    expect(supportsParallelToolCalls('gemini-native')).toBe(false);
    expect(supportsParallelToolCalls('ollama-native')).toBe(false);
    expect(supportsParallelToolCalls(undefined)).toBe(false);
  });
});

describe('supportsToolChoice', () => {
  it('omits tool_choice for always-thinking DeepSeek V4 models', () => {
    // Default (no stored effort) ⇒ DeepSeek is in thinking mode ⇒ the
    // field must be omitted to avoid the HTTP 400.
    expect(supportsToolChoice('openai', 'deepseek-v4-flash', undefined)).toBe(false);
    expect(supportsToolChoice('openai', 'deepseek-v4-pro', 'high')).toBe(false);
    expect(supportsToolChoice('openai', 'deepseek-reasoner', 'medium')).toBe(false);
  });

  it('re-enables tool_choice when DeepSeek thinking is explicitly disabled', () => {
    // `off` sends `thinking:{type:'disabled'}`, which makes forced
    // tool_choice valid again.
    expect(supportsToolChoice('openai', 'deepseek-v4-flash', 'off')).toBe(true);
  });

  it('allows tool_choice for non-DeepSeek OpenAI models regardless of effort', () => {
    expect(supportsToolChoice('openai', 'gpt-5.3', 'high')).toBe(true);
    expect(supportsToolChoice('openai', 'deepseek-v3.2', 'high')).toBe(true);
  });

  it('allows tool_choice for every other dialect', () => {
    expect(supportsToolChoice('anthropic-native', 'claude-opus-4-7', 'high')).toBe(true);
    expect(supportsToolChoice('gemini-native', 'gemini-3-pro', 'high')).toBe(true);
    expect(supportsToolChoice('ollama-native', 'qwen3', 'high')).toBe(true);
    expect(supportsToolChoice(undefined, 'whatever', undefined)).toBe(true);
  });
});
