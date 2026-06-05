import { describe, expect, it, vi, beforeEach } from 'vitest';

const anthropicPersisted = {
  id: 'p-anthropic',
  name: 'Anthropic',
  baseUrl: 'https://api.anthropic.com',
  dialect: 'anthropic-native' as const,
  enabled: true,
  models: [],
  lastDiscoveredAt: undefined,
  apiKey: 'sk-ant-test'
};

const geminiPersisted = {
  id: 'p-gemini',
  name: 'Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com',
  dialect: 'gemini-native' as const,
  enabled: true,
  models: [],
  lastDiscoveredAt: undefined,
  apiKey: 'gem-key'
};

beforeEach(() => {
  vi.resetModules();
});

describe('discoverModels — native capability parsing', () => {
  it('parses Anthropic thinking + context from capabilities', async () => {
    vi.doMock('@main/providers/providerStore', () => ({
      getProviderWithKey: vi.fn(async () => anthropicPersisted),
      updateProvider: vi.fn(async () => anthropicPersisted)
    }));

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'claude-opus-4-7',
              display_name: 'Claude Opus 4.7',
              max_input_tokens: 1_000_000,
              capabilities: {
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
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { discoverModels } = await import('@main/providers/modelDiscovery');
    const models = await discoverModels('p-anthropic', true);
    expect(models[0]?.contextWindow).toBe(1_000_000);
    expect(models[0]?.thinking?.supported).toBe(true);
    expect(models[0]?.thinking?.wireStyle).toBe('anthropic-adaptive');
  });

  it('parses Gemini thinking + context from models list', async () => {
    vi.doMock('@main/providers/providerStore', () => ({
      getProviderWithKey: vi.fn(async () => geminiPersisted),
      updateProvider: vi.fn(async () => geminiPersisted)
    }));

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              inputTokenLimit: 1_048_576,
              outputTokenLimit: 65_536,
              supportedGenerationMethods: ['generateContent', 'countTokens'],
              thinking: true,
              version: '2.5-preview-04-17'
            },
            {
              name: 'models/gemini-3-pro-preview',
              displayName: 'Gemini 3 Pro Preview',
              inputTokenLimit: 1_048_576,
              supportedGenerationMethods: ['generateContent'],
              thinking: true,
              version: '3-pro-preview-11-2025'
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { discoverModels } = await import('@main/providers/modelDiscovery');
    const models = await discoverModels('p-gemini', true);
    const flash = models.find((m) => m.id === 'gemini-2.5-flash');
    const pro = models.find((m) => m.id === 'gemini-3-pro-preview');
    expect(flash?.contextWindow).toBe(1_048_576);
    expect(flash?.thinking?.wireStyle).toBe('gemini-budget');
    expect(pro?.thinking?.wireStyle).toBe('gemini-level');
  });
});
