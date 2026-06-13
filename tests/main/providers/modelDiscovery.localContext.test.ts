/**
 * Local OpenAI-compatible daemons: LM Studio, llama.cpp, SGLang native probes.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const localPersisted = {
  id: 'p-local',
  name: 'Local',
  baseUrl: 'http://127.0.0.1:1234',
  dialect: 'openai' as const,
  enabled: true,
  models: [],
  lastDiscoveredAt: undefined,
  apiKey: ''
};

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => localPersisted),
  updateProvider: vi.fn(async () => localPersisted)
}));

import { discoverModels } from '@main/providers/modelDiscovery';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

describe('discoverModels — local server context probes', () => {
  it('enriches LM Studio models via /api/v1/models', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith('/api/v1/models')) {
        return jsonResponse(200, {
          data: [
            {
              id: 'qwen2.5-7b-instruct',
              max_context_length: 32768,
              loaded_instances: [{ config: { context_length: 12288 } }]
            }
          ]
        });
      }
      if (url.endsWith('/v1/models')) {
        return jsonResponse(200, { data: [{ id: 'qwen2.5-7b-instruct' }] });
      }
      return new Response('not found', { status: 404 });
    });

    try {
      const models = await discoverModels('p-local', true);
      expect(models[0]?.contextWindow).toBe(12288);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('enriches llama.cpp models via /props n_ctx', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith('/props')) {
        return jsonResponse(200, {
          default_generation_settings: { n_ctx: 4096 }
        });
      }
      if (url.endsWith('/v1/models')) {
        return jsonResponse(200, { data: [{ id: 'local-model' }] });
      }
      return new Response('not found', { status: 404 });
    });

    try {
      const models = await discoverModels('p-local', true);
      expect(models[0]?.contextWindow).toBe(4096);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('enriches SGLang models via /get_model_info', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      if (url.endsWith('/get_model_info')) {
        return jsonResponse(200, { context_length: 8192 });
      }
      if (url.endsWith('/v1/models')) {
        return jsonResponse(200, { data: [{ id: 'meta-llama/Llama-3.1-8B-Instruct' }] });
      }
      return new Response('not found', { status: 404 });
    });

    try {
      const models = await discoverModels('p-local', true);
      expect(models[0]?.contextWindow).toBe(8192);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('discoverModels — cache invalidation for host context fallbacks', () => {
  it('re-fetches when OpenAI cache lacks context metadata', async () => {
    const stale = {
      ...localPersisted,
      id: 'p-openai-stale',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-test',
      models: [{ id: 'gpt-4o' }],
      lastDiscoveredAt: Date.now()
    };

    const { getProviderWithKey } = await import('@main/providers/providerStore');
    vi.mocked(getProviderWithKey).mockResolvedValue(stale);

    let fetchCount = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = requestUrl(input);
      fetchCount += 1;
      if (url.endsWith('/v1/models')) {
        return jsonResponse(200, { data: [{ id: 'gpt-4o' }] });
      }
      return new Response('not found', { status: 404 });
    });

    try {
      const models = await discoverModels('p-openai-stale', false);
      expect(fetchCount).toBeGreaterThanOrEqual(1);
      expect(models[0]?.contextWindow).toBe(128_000);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
