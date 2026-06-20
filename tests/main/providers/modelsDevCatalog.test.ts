import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/vyotiq-test' }
}));

vi.mock('@main/secrets/safeStore', () => ({
  readPlainJson: vi.fn(async () => null),
  writePlainJson: vi.fn(async () => undefined)
}));

import { enrichModelsFromModelsDev, _resetModelsDevCatalogForTests } from '@main/providers/modelsDevCatalog.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetModelsDevCatalogForTests();
});

describe('enrichModelsFromModelsDev', () => {
  it('applies context, pricing, and thinking from catalog rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        nvidia: {
          models: {
            'z-ai/glm-5.1': {
              limit: { context: 128_000 },
              cost: { input: 0, output: 0 },
              reasoning: true,
              tool_call: true,
              reasoning_options: [{ type: 'effort', values: ['low', 'high'] }]
            }
          }
        }
      })
    );

    const provider = {
      id: 'p1',
      name: 'NVIDIA',
      baseUrl: 'https://integrate.api.nvidia.com',
      dialect: 'openai' as const,
      enabled: true,
      apiKey: 'k'
    };

    const models = await enrichModelsFromModelsDev(provider, [{ id: 'z-ai/glm-5.1' }]);
    expect(models[0]?.contextWindow).toBe(128_000);
    expect(models[0]?.pricing?.inputPerMillion).toBe(0);
    expect(models[0]?.thinking?.supported).toBe(true);
    expect(models[0]?.supportedParameters).toContain('reasoning');
  });

  it('applies inputModalities from models.dev modalities.input', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        openai: {
          models: {
            'gpt-4o': {
              modalities: { input: ['text', 'image'], output: ['text'] }
            }
          }
        }
      })
    );

    const provider = {
      id: 'p1',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com',
      dialect: 'openai' as const,
      enabled: true,
      apiKey: 'k'
    };

    const models = await enrichModelsFromModelsDev(provider, [{ id: 'gpt-4o' }]);
    expect(models[0]?.inputModalities).toEqual(['text', 'image']);
  });
});
