import { describe, expect, it } from 'vitest';
import {
  contextWindowForDeepSeekApiModel,
  contextWindowFromOllamaModelInfo,
  contextWindowFromOpenAiModelRow,
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

describe('contextWindowFromOpenAiModelRow', () => {
  it('reads canonical OpenRouter fields', () => {
    expect(
      contextWindowFromOpenAiModelRow({
        context_length: 128000,
        top_provider: { context_length: 65536 }
      })
    ).toBe(128000);
  });

  it('reads vLLM max_model_len', () => {
    expect(contextWindowFromOpenAiModelRow({ max_model_len: 32768 })).toBe(32768);
  });

  it('reads gateway max_input_tokens and inputTokenLimit', () => {
    expect(contextWindowFromOpenAiModelRow({ max_input_tokens: 200000 })).toBe(200000);
    expect(contextWindowFromOpenAiModelRow({ inputTokenLimit: 131072 })).toBe(131072);
  });

  it('reads LM Studio max_context_length', () => {
    expect(contextWindowFromOpenAiModelRow({ max_context_length: 131072 })).toBe(131072);
  });

  it('reads meta.context_size from LocalAI-style rows', () => {
    expect(
      contextWindowFromOpenAiModelRow({
        meta: { context_size: 8192, n_ctx_train: 32768 }
      })
    ).toBe(8192);
  });

  it('coerces string numbers', () => {
    expect(contextWindowFromOpenAiModelRow({ context_length: '8192' })).toBe(8192);
  });
});
