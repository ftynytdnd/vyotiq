import { describe, expect, it } from 'vitest';
import {
  supportsForcedToolChoice,
  supportsParallelToolCalls
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

describe('supportsForcedToolChoice', () => {
  it('matches documented dialect behavior', () => {
    expect(supportsForcedToolChoice('openai')).toBe(true);
    expect(supportsForcedToolChoice('anthropic-native')).toBe(true);
    expect(supportsForcedToolChoice('ollama-native')).toBe(false);
  });
});
