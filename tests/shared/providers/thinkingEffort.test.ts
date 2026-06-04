/**
 * Per-dialect thinking-effort resolution + wire mapping.
 */

import { describe, expect, it } from 'vitest';
import {
  THINKING_EFFORTS,
  isDeepSeekThinkingModel,
  supportedThinkingEfforts,
  resolveThinkingEffort,
  modelRejectsToolChoice,
  mapOpenAiReasoningEffort,
  mapDeepSeekThinking,
  mapAnthropicThinking,
  mapGeminiThinkingConfig,
  mapOllamaThink
} from '@shared/providers/thinkingEffort';
import type { ProviderConfig } from '@shared/types/provider';

describe('THINKING_EFFORTS', () => {
  it('is ordered weakest → strongest with off first', () => {
    expect(THINKING_EFFORTS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'max']);
  });
});

describe('isDeepSeekThinkingModel', () => {
  it('matches V4 + reasoner stems (incl. dated snapshots)', () => {
    expect(isDeepSeekThinkingModel('deepseek-v4-flash')).toBe(true);
    expect(isDeepSeekThinkingModel('deepseek-v4-pro-20260101')).toBe(true);
    expect(isDeepSeekThinkingModel('deepseek-reasoner')).toBe(true);
  });

  it('does not match non-thinking DeepSeek or other vendors', () => {
    expect(isDeepSeekThinkingModel('deepseek-v3.2')).toBe(false);
    expect(isDeepSeekThinkingModel('gpt-5.3')).toBe(false);
  });
});

describe('supportedThinkingEfforts', () => {
  it('offers max for DeepSeek thinking models, minimal for generic OpenAI', () => {
    expect(supportedThinkingEfforts('openai', 'deepseek-v4-flash')).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'max'
    ]);
    expect(supportedThinkingEfforts('openai', 'gpt-5.3')).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high'
    ]);
  });

  it('offers anthropic + gemini + ollama subsets', () => {
    expect(supportedThinkingEfforts('anthropic-native', 'claude-opus-4-7')).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'max'
    ]);
    expect(supportedThinkingEfforts('gemini-native', 'gemini-3-pro')).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high'
    ]);
    // Ollama is binary (think on/off).
    expect(supportedThinkingEfforts('ollama-native', 'qwen3')).toEqual(['off', 'high']);
  });

  it('always includes off', () => {
    for (const d of ['openai', 'anthropic-native', 'gemini-native', 'ollama-native'] as const) {
      expect(supportedThinkingEfforts(d, 'any-model')).toContain('off');
    }
  });
});

describe('resolveThinkingEffort', () => {
  it('prefers the per-model override', () => {
    const provider = {
      dialect: 'openai',
      modelThinking: { 'gpt-5.3': 'high' }
    } as unknown as ProviderConfig;
    expect(resolveThinkingEffort(provider, 'gpt-5.3')).toBe('high');
  });

  it('falls back to the legacy anthropicThinking flag (anthropic dialect only)', () => {
    const provider = {
      dialect: 'anthropic-native',
      anthropicThinking: { enabled: true, effort: 'low' }
    } as unknown as ProviderConfig;
    expect(resolveThinkingEffort(provider, 'claude-opus-4-7')).toBe('low');
  });

  it('defaults legacy fallback to medium when enabled without an effort', () => {
    const provider = {
      dialect: 'anthropic-native',
      anthropicThinking: { enabled: true }
    } as unknown as ProviderConfig;
    expect(resolveThinkingEffort(provider, 'claude-opus-4-7')).toBe('medium');
  });

  it('returns undefined when nothing is configured', () => {
    const provider = { dialect: 'openai' } as unknown as ProviderConfig;
    expect(resolveThinkingEffort(provider, 'gpt-5.3')).toBeUndefined();
  });
});

describe('modelRejectsToolChoice', () => {
  it('is true for DeepSeek thinking models while thinking is active', () => {
    expect(modelRejectsToolChoice('openai', 'deepseek-v4-flash', undefined)).toBe(true);
    expect(modelRejectsToolChoice('openai', 'deepseek-v4-flash', 'high')).toBe(true);
  });

  it('is false when DeepSeek thinking is explicitly off', () => {
    expect(modelRejectsToolChoice('openai', 'deepseek-v4-flash', 'off')).toBe(false);
  });

  it('is false for non-DeepSeek + non-openai dialects', () => {
    expect(modelRejectsToolChoice('openai', 'gpt-5.3', 'high')).toBe(false);
    expect(modelRejectsToolChoice('anthropic-native', 'claude-opus-4-7', 'high')).toBe(false);
  });
});

describe('mapOpenAiReasoningEffort', () => {
  it('omits for off/undefined, clamps max→high', () => {
    expect(mapOpenAiReasoningEffort(undefined)).toBeNull();
    expect(mapOpenAiReasoningEffort('off')).toBeNull();
    expect(mapOpenAiReasoningEffort('minimal')).toBe('minimal');
    expect(mapOpenAiReasoningEffort('high')).toBe('high');
    expect(mapOpenAiReasoningEffort('max')).toBe('high');
  });
});

describe('mapDeepSeekThinking', () => {
  it('disables on off and enables otherwise', () => {
    expect(mapDeepSeekThinking('off')).toEqual({ type: 'disabled' });
    expect(mapDeepSeekThinking('high')).toEqual({ type: 'enabled' });
    expect(mapDeepSeekThinking(undefined)).toEqual({ type: 'enabled' });
  });
});

describe('mapAnthropicThinking', () => {
  it('returns null for off / non-thinking models', () => {
    expect(mapAnthropicThinking('claude-opus-4-7', 'off', 4096, 4096)).toBeNull();
    expect(mapAnthropicThinking('claude-haiku-3', 'high', 4096, 4096)).toBeNull();
  });

  it('uses adaptive + effortField for 4.6+ models', () => {
    const out = mapAnthropicThinking('claude-opus-4-7', 'max', 8192, 4096);
    expect(out?.config).toEqual({ type: 'adaptive' });
    expect(out?.effortField).toBe('max');
  });

  it('derives a clamped budget_tokens for legacy thinking models', () => {
    const out = mapAnthropicThinking('claude-sonnet-4-5', 'high', 4000, 4096);
    expect(out?.config).toMatchObject({ type: 'enabled' });
    const budget = (out?.config as { budget_tokens: number }).budget_tokens;
    expect(budget).toBeLessThan(4000);
  });
});

describe('mapGeminiThinkingConfig', () => {
  it('uses thinkingLevel on 3.x and budget on legacy 2.5', () => {
    expect(mapGeminiThinkingConfig('gemini-3-pro', 'high')).toEqual({ thinkingLevel: 'high' });
    expect(mapGeminiThinkingConfig('gemini-3-pro', 'max')).toEqual({ thinkingLevel: 'high' });
    expect(mapGeminiThinkingConfig('gemini-2.5-pro', 'off')).toEqual({ thinkingBudget: 0 });
    expect(mapGeminiThinkingConfig('gemini-2.5-pro', 'high')).toEqual({ thinkingBudget: 16384 });
  });

  it('omits when effort is undefined', () => {
    expect(mapGeminiThinkingConfig('gemini-3-pro', undefined)).toBeNull();
  });
});

describe('mapOllamaThink', () => {
  it('is a boolean toggle', () => {
    expect(mapOllamaThink('off')).toBe(false);
    expect(mapOllamaThink(undefined)).toBe(false);
    expect(mapOllamaThink('high')).toBe(true);
    expect(mapOllamaThink('low')).toBe(true);
  });
});
