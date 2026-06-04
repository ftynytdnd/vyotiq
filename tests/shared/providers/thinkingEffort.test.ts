/**
 * Per-dialect thinking-effort resolution + wire mapping.
 */

import { describe, expect, it } from 'vitest';
import {
  THINKING_EFFORTS,
  isDeepSeekThinkingModel,
  isThinkingCapableModel,
  supportedThinkingEfforts,
  resolveThinkingEffort,
  resolveEffectiveThinkingEffort,
  modelRejectsToolChoice,
  mapOpenAiReasoningEffort,
  mapDeepSeekThinking,
  mapAnthropicThinking,
  mapGeminiThinkingConfig,
  resolveGeminiThinkingConfig,
  resolveStreamerThinkingEffort,
  mapOllamaThink,
  normalizePersistedThinkingEffort,
  normalizeModelThinkingMap,
  effortDisplayLabel
} from '@shared/providers/thinkingEffort';
import type { ProviderConfig } from '@shared/types/provider';

describe('effortDisplayLabel', () => {
  it('returns null for default effort', () => {
    expect(effortDisplayLabel(undefined)).toBeNull();
  });
  it('returns a human label when effort is set', () => {
    expect(effortDisplayLabel('high')).toBe('High');
  });
});

describe('THINKING_EFFORTS', () => {
  it('is ordered weakest → strongest with off first', () => {
    expect(THINKING_EFFORTS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  });
});

describe('normalizePersistedThinkingEffort', () => {
  it('maps legacy max → xhigh', () => {
    expect(normalizePersistedThinkingEffort('max')).toBe('xhigh');
    expect(normalizePersistedThinkingEffort('high')).toBe('high');
  });
});

describe('normalizeModelThinkingMap', () => {
  it('migrates max values on load', () => {
    const { map, mutated } = normalizeModelThinkingMap({ 'gpt-5': 'max' });
    expect(mutated).toBe(true);
    expect(map).toEqual({ 'gpt-5': 'xhigh' });
  });
});

describe('isThinkingCapableModel', () => {
  it('detects reasoning models per dialect', () => {
    expect(isThinkingCapableModel('openai', 'gpt-5.3')).toBe(true);
    expect(isThinkingCapableModel('openai', 'gpt-4o')).toBe(false);
    expect(isThinkingCapableModel('openai', 'deepseek-v4-flash')).toBe(true);
    expect(isThinkingCapableModel('anthropic-native', 'claude-opus-4-7')).toBe(true);
    expect(isThinkingCapableModel('anthropic-native', 'claude-haiku-3')).toBe(false);
    expect(isThinkingCapableModel('gemini-native', 'gemini-3-pro')).toBe(true);
    expect(isThinkingCapableModel('ollama-native', 'qwen3')).toBe(true);
    expect(isThinkingCapableModel('ollama-native', 'llama3')).toBe(false);
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
  it('returns empty for non-capable models', () => {
    expect(supportedThinkingEfforts('openai', 'gpt-4o')).toEqual([]);
  });

  it('offers xhigh for DeepSeek thinking models, minimal for generic OpenAI', () => {
    expect(supportedThinkingEfforts('openai', 'deepseek-v4-flash')).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'xhigh'
    ]);
    expect(supportedThinkingEfforts('openai', 'gpt-5.3')).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh'
    ]);
  });

  it('offers anthropic + gemini + ollama subsets', () => {
    expect(supportedThinkingEfforts('anthropic-native', 'claude-opus-4-7')).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'xhigh'
    ]);
    expect(supportedThinkingEfforts('gemini-native', 'gemini-3-pro')).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high'
    ]);
    expect(supportedThinkingEfforts('ollama-native', 'qwen3')).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh'
    ]);
    expect(supportedThinkingEfforts('ollama-native', 'gpt-oss')).toContain('minimal');
  });

  it('always includes off when capable', () => {
    expect(supportedThinkingEfforts('openai', 'gpt-5.3')).toContain('off');
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

  it('returns undefined when nothing is configured', () => {
    const provider = { dialect: 'openai' } as unknown as ProviderConfig;
    expect(resolveThinkingEffort(provider, 'gpt-5.3')).toBeUndefined();
  });
});

describe('resolveEffectiveThinkingEffort', () => {
  it('prefers composer override over stored modelThinking', () => {
    const provider = {
      dialect: 'openai',
      modelThinking: { 'gpt-5.3': 'low' }
    } as unknown as ProviderConfig;
    expect(resolveEffectiveThinkingEffort(provider, 'gpt-5.3', 'xhigh')).toBe('xhigh');
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
});

describe('mapOpenAiReasoningEffort', () => {
  it('omits for off/undefined', () => {
    expect(mapOpenAiReasoningEffort(undefined)).toBeNull();
    expect(mapOpenAiReasoningEffort('off')).toBeNull();
  });

  it('passes xhigh for OpenAI and max for DeepSeek', () => {
    expect(mapOpenAiReasoningEffort('xhigh', 'gpt-5.3')).toBe('xhigh');
    expect(mapOpenAiReasoningEffort('xhigh', 'deepseek-v4-flash')).toBe('max');
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

  it('uses adaptive + xhigh effortField for 4.6+ models', () => {
    const out = mapAnthropicThinking('claude-opus-4-7', 'xhigh', 8192, 4096);
    expect(out?.config).toEqual({ type: 'adaptive' });
    expect(out?.effortField).toBe('xhigh');
  });
});

describe('mapGeminiThinkingConfig', () => {
  it('uses thinkingLevel on 3.x and budget on legacy 2.5', () => {
    expect(mapGeminiThinkingConfig('gemini-3-pro', 'high')).toEqual({ thinkingLevel: 'high' });
    expect(mapGeminiThinkingConfig('gemini-3-pro', 'xhigh')).toEqual({ thinkingLevel: 'high' });
    expect(mapGeminiThinkingConfig('gemini-3-pro', 'off')).toBeNull();
    expect(mapGeminiThinkingConfig('gemini-2.5-pro', 'off')).toEqual({ thinkingBudget: 0 });
    expect(mapGeminiThinkingConfig('gemini-2.5-pro', 'high')).toEqual({ thinkingBudget: 16384 });
  });

  it('omits when effort is undefined', () => {
    expect(mapGeminiThinkingConfig('gemini-3-pro', undefined)).toBeNull();
  });
});

describe('resolveGeminiThinkingConfig', () => {
  it('applies dynamic budget when effort unset on 2.5', () => {
    expect(resolveGeminiThinkingConfig('gemini-2.5-flash', undefined)).toEqual({
      thinkingBudget: -1
    });
  });
});

describe('resolveStreamerThinkingEffort', () => {
  it('prefers the request field over stored modelThinking', () => {
    const provider = {
      dialect: 'openai',
      modelThinking: { 'gpt-5.3': 'low' }
    } as unknown as ProviderConfig;
    expect(resolveStreamerThinkingEffort(provider, 'gpt-5.3', 'xhigh')).toBe('xhigh');
    expect(resolveStreamerThinkingEffort(provider, 'gpt-5.3', undefined)).toBe('low');
  });
});

describe('mapOllamaThink', () => {
  it('omits when effort unset', () => {
    expect(mapOllamaThink(undefined, 'qwen3')).toBeUndefined();
  });

  it('uses levels for gpt-oss and boolean for others', () => {
    expect(mapOllamaThink('off', 'qwen3')).toBe(false);
    expect(mapOllamaThink('high', 'qwen3')).toBe(true);
    expect(mapOllamaThink('xhigh', 'gpt-oss')).toBe('high');
    expect(mapOllamaThink('minimal', 'gpt-oss')).toBe('low');
  });
});
