/**
 * Per-dialect thinking-effort resolution + wire mapping.
 */

import { describe, expect, it } from 'vitest';
import {
  THINKING_EFFORTS,
  isThinkingCapableModel,
  modelDeclaresReasoningSupport,
  modelIdTail,
  supportedThinkingEfforts,
  resolveThinkingEffort,
  resolveEffectiveThinkingEffort,
  modelRejectsToolChoice,
  mapOpenAiReasoningEffort,
  mapOpenRouterReasoning,
  openRouterIncludeReasoning,
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
import type { ModelThinkingCapabilities, ProviderConfig } from '@shared/types/provider';

const openRouterReasoning: ModelThinkingCapabilities = {
  supported: true,
  wireStyle: 'openai-reasoning',
  efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
};

const deepSeekCaps: ModelThinkingCapabilities = {
  supported: true,
  wireStyle: 'openai-deepseek',
  efforts: ['off', 'low', 'medium', 'high', 'xhigh'],
  defaultOn: true,
  rejectsToolChoice: true,
  mapsXhighToMax: true
};

const anthropicAdaptive: ModelThinkingCapabilities = {
  supported: true,
  wireStyle: 'anthropic-adaptive',
  efforts: ['off', 'low', 'medium', 'high', 'xhigh']
};

const geminiLevel: ModelThinkingCapabilities = {
  supported: true,
  wireStyle: 'gemini-level',
  efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
};

const geminiBudget: ModelThinkingCapabilities = {
  supported: true,
  wireStyle: 'gemini-budget',
  defaultOn: true,
  efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
};

const ollamaBoolean: ModelThinkingCapabilities = {
  supported: true,
  wireStyle: 'ollama-boolean',
  efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
};

const ollamaLevels: ModelThinkingCapabilities = {
  supported: true,
  wireStyle: 'ollama-levels',
  efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
};

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

describe('modelIdTail', () => {
  it('strips OpenRouter-style provider prefixes', () => {
    expect(modelIdTail('openai/o1')).toBe('o1');
    expect(modelIdTail('anthropic/claude-opus-4-7')).toBe('claude-opus-4-7');
  });
});

describe('modelDeclaresReasoningSupport', () => {
  it('detects OpenRouter supported_parameters', () => {
    expect(modelDeclaresReasoningSupport(['temperature', 'reasoning'])).toBe(true);
    expect(modelDeclaresReasoningSupport(['tools'])).toBe(false);
  });
});

describe('isThinkingCapableModel', () => {
  it('returns false without discovery metadata', () => {
    expect(isThinkingCapableModel('openai', 'gpt-5.3')).toBe(false);
    expect(isThinkingCapableModel('openai', 'gpt-4o')).toBe(false);
    expect(isThinkingCapableModel('ollama-native', 'llama3')).toBe(false);
  });

  it('honors discovery metadata', () => {
    expect(
      isThinkingCapableModel('openai', 'vendor/obscure-model', {
        supportedParameters: ['reasoning', 'tools']
      })
    ).toBe(true);
    expect(
      isThinkingCapableModel('anthropic-native', 'claude-opus-4-7', {
        thinking: anthropicAdaptive
      })
    ).toBe(true);
    expect(
      isThinkingCapableModel('gemini-native', 'gemini-3-pro', { thinking: geminiLevel })
    ).toBe(true);
    expect(isThinkingCapableModel('ollama-native', 'qwen3', { thinking: ollamaBoolean })).toBe(
      true
    );
  });
});

describe('supportedThinkingEfforts', () => {
  it('returns empty for non-capable models', () => {
    expect(supportedThinkingEfforts('openai', 'gpt-4o')).toEqual([]);
  });

  it('returns discovered effort lists', () => {
    expect(supportedThinkingEfforts('openai', 'deepseek-v4-flash', { thinking: deepSeekCaps })).toEqual(
      ['off', 'low', 'medium', 'high', 'xhigh']
    );
    expect(supportedThinkingEfforts('openai', 'gpt-5.3', { thinking: openRouterReasoning })).toEqual(
      ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
    );
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
    expect(modelRejectsToolChoice('openai', 'deepseek-v4-flash', undefined, deepSeekCaps)).toBe(
      true
    );
    expect(modelRejectsToolChoice('openai', 'deepseek-v4-flash', 'high', deepSeekCaps)).toBe(true);
  });

  it('is false when DeepSeek thinking is explicitly off', () => {
    expect(modelRejectsToolChoice('openai', 'deepseek-v4-flash', 'off', deepSeekCaps)).toBe(false);
  });
});

describe('mapOpenRouterReasoning', () => {
  it('maps effort to nested reasoning block', () => {
    expect(mapOpenRouterReasoning('high')).toEqual({ effort: 'high', exclude: false });
    expect(mapOpenRouterReasoning('off')).toEqual({ effort: 'none', exclude: true });
    expect(mapOpenRouterReasoning('xhigh', deepSeekCaps)).toEqual({
      effort: 'xhigh',
      exclude: false
    });
  });

  it('include_reasoning follows effort', () => {
    expect(openRouterIncludeReasoning(undefined)).toBe(false);
    expect(openRouterIncludeReasoning('off')).toBe(false);
    expect(openRouterIncludeReasoning('medium')).toBe(true);
  });
});

describe('mapOpenAiReasoningEffort', () => {
  it('omits for off/undefined', () => {
    expect(mapOpenAiReasoningEffort(undefined)).toBeNull();
    expect(mapOpenAiReasoningEffort('off')).toBeNull();
  });

  it('passes xhigh for OpenAI and max for DeepSeek', () => {
    expect(mapOpenAiReasoningEffort('xhigh', openRouterReasoning)).toBe('xhigh');
    expect(mapOpenAiReasoningEffort('xhigh', deepSeekCaps)).toBe('max');
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
    expect(mapAnthropicThinking('off', 4096, 4096)).toBeNull();
    expect(mapAnthropicThinking('high', 4096, 4096)).toBeNull();
  });

  it('uses adaptive + max effortField for adaptive models at xhigh', () => {
    const out = mapAnthropicThinking('xhigh', 8192, 4096, anthropicAdaptive);
    expect(out?.config).toEqual({ type: 'adaptive' });
    expect(out?.effortField).toBe('max');
  });
});

describe('mapGeminiThinkingConfig', () => {
  it('uses thinkingLevel on level models and budget on legacy budget models', () => {
    expect(mapGeminiThinkingConfig('high', geminiLevel)).toEqual({ thinkingLevel: 'high' });
    expect(mapGeminiThinkingConfig('xhigh', geminiLevel)).toEqual({ thinkingLevel: 'high' });
    expect(mapGeminiThinkingConfig('off', geminiLevel)).toBeNull();
    expect(mapGeminiThinkingConfig('off', geminiBudget)).toEqual({ thinkingBudget: 0 });
    expect(mapGeminiThinkingConfig('high', geminiBudget)).toEqual({ thinkingBudget: 16384 });
  });

  it('omits when effort is undefined', () => {
    expect(mapGeminiThinkingConfig(undefined, geminiLevel)).toBeNull();
  });
});

describe('resolveGeminiThinkingConfig', () => {
  it('applies dynamic budget when effort unset on budget models', () => {
    expect(resolveGeminiThinkingConfig(undefined, geminiBudget)).toEqual({
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
  it('omits when effort unset or model not thinking-capable', () => {
    expect(mapOllamaThink(undefined, ollamaBoolean)).toBeUndefined();
    expect(mapOllamaThink('high', undefined)).toBeUndefined();
  });

  it('uses levels for ollama-levels and boolean for others', () => {
    expect(mapOllamaThink('off', ollamaBoolean)).toBe(false);
    expect(mapOllamaThink('high', ollamaBoolean)).toBe(true);
    expect(mapOllamaThink('xhigh', ollamaLevels)).toBe('high');
    expect(mapOllamaThink('minimal', ollamaLevels)).toBe('low');
  });
});
