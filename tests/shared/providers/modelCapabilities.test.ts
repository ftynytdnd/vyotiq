import { describe, expect, it } from 'vitest';
import {
  contextWindowForDeepSeekApiModel,
  contextWindowFromOllamaModelInfo,
  thinkingForDeepSeekApiModel,
  thinkingFromAnthropicCapabilities,
  thinkingFromGeminiModel,
  thinkingFromOllamaShow,
  thinkingFromOpenAiExtendedFields,
  thinkingFromSupportedParameters
} from '@shared/providers/modelCapabilities.js';

describe('thinkingFromOpenAiExtendedFields', () => {
  it('detects reasoning from features array', () => {
    const caps = thinkingFromOpenAiExtendedFields({
      features: ['streaming', 'reasoning_effort']
    });
    expect(caps?.supported).toBe(true);
    expect(caps?.wireStyle).toBe('openai-reasoning');
  });

  it('detects reasoning from groups array', () => {
    const caps = thinkingFromOpenAiExtendedFields({
      groups: ['reasoning'],
      features: ['streaming']
    });
    expect(caps?.supported).toBe(true);
  });
});

describe('thinkingFromSupportedParameters', () => {
  it('detects OpenRouter reasoning parameters', () => {
    const caps = thinkingFromSupportedParameters(['temperature', 'reasoning']);
    expect(caps?.supported).toBe(true);
    expect(caps?.wireStyle).toBe('openai-reasoning');
  });

  it('detects DeepSeek thinking toggle', () => {
    const caps = thinkingFromSupportedParameters(['thinking', 'reasoning_effort']);
    expect(caps?.wireStyle).toBe('openai-deepseek');
    expect(caps?.rejectsToolChoice).toBe(true);
  });
});

describe('thinkingFromAnthropicCapabilities', () => {
  it('parses adaptive thinking + effort levels', () => {
    const caps = thinkingFromAnthropicCapabilities({
      thinking: {
        supported: true,
        types: { adaptive: { supported: true }, enabled: { supported: true } }
      },
      effort: {
        supported: true,
        low: { supported: true },
        medium: { supported: true },
        high: { supported: true },
        max: { supported: true }
      }
    });
    expect(caps?.supported).toBe(true);
    expect(caps?.wireStyle).toBe('anthropic-adaptive');
    expect(caps?.efforts).toContain('high');
    expect(caps?.efforts).toContain('xhigh');
  });
});

describe('thinkingFromGeminiModel', () => {
  it('uses budget wire for 2.5 models', () => {
    const caps = thinkingFromGeminiModel({ thinking: true, version: '2.5-preview' });
    expect(caps?.wireStyle).toBe('gemini-budget');
    expect(caps?.defaultOn).toBe(true);
  });

  it('uses level wire for 3.x models', () => {
    const caps = thinkingFromGeminiModel({ thinking: true, version: '3-pro-preview' });
    expect(caps?.wireStyle).toBe('gemini-level');
  });
});

describe('thinkingFromOllamaShow', () => {
  it('detects boolean thinking', () => {
    const caps = thinkingFromOllamaShow({ capabilities: ['completion', 'thinking'] });
    expect(caps?.wireStyle).toBe('ollama-boolean');
  });

  it('detects level thinking for gpt-oss family', () => {
    const caps = thinkingFromOllamaShow({
      capabilities: ['thinking'],
      model_info: { general: { architecture: 'gptoss' } }
    });
    expect(caps?.wireStyle).toBe('ollama-levels');
  });
});

describe('thinkingForDeepSeekApiModel', () => {
  it('marks DeepSeek host protocol', () => {
    const caps = thinkingForDeepSeekApiModel();
    expect(caps.wireStyle).toBe('openai-deepseek');
    expect(caps.defaultOn).toBe(true);
  });
});

describe('contextWindowForDeepSeekApiModel', () => {
  it('returns 1M context per DeepSeek V4 host docs', () => {
    expect(contextWindowForDeepSeekApiModel()).toBe(1_000_000);
  });
});

describe('contextWindowFromOllamaModelInfo', () => {
  it('reads dotted architecture context_length keys', () => {
    expect(
      contextWindowFromOllamaModelInfo({
        'llama.context_length': 131072,
        'general.architecture': 'llama'
      })
    ).toBe(131072);
  });
});
