/**
 * OpenAI-dialect providers pointing at an Ollama daemon expose `/v1/models`
 * without context sizes. Discovery should fall back to `/api/show` when
 * `/api/version` confirms the Ollama API surface is present.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const persisted = {
  id: 'p-local',
  name: 'Ollama OpenAI shim',
  baseUrl: 'http://127.0.0.1:11434',
  dialect: 'openai' as const,
  enabled: true,
  models: [],
  lastDiscoveredAt: undefined,
  apiKey: ''
};

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => persisted),
  updateProvider: vi.fn(async () => persisted)
}));

import { discoverModels } from '@main/providers/modelDiscovery';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

beforeEach(() => {
  vi.resetModules();
});

describe('discoverModels — OpenAI dialect on Ollama', () => {
  it('enriches context via /api/show when /v1/models omits context_window', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) {
        return jsonResponse(200, {
          data: [{ id: 'llama3.2:latest' }]
        });
      }
      if (url.endsWith('/api/version')) {
        return jsonResponse(200, { version: '0.5.0' });
      }
      if (url.endsWith('/api/show') && init?.method === 'POST') {
        return jsonResponse(200, { parameters: 'num_ctx 8192\n' });
      }
      return new Response('not found', { status: 404 });
    });

    try {
      const models = await discoverModels('p-local', true);
      expect(models).toHaveLength(1);
      expect(models[0]?.contextWindow).toBe(8192);
      expect(fetchSpy.mock.calls.some((c) => String(c[0]).endsWith('/api/version'))).toBe(
        true
      );
      expect(fetchSpy.mock.calls.some((c) => String(c[0]).endsWith('/api/show'))).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('skips Ollama probes when /v1/models already includes context and thinking metadata', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) {
        return jsonResponse(200, {
          data: [
            {
              id: 'gpt-4o',
              context_length: 128000,
              supported_parameters: ['temperature', 'reasoning']
            }
          ]
        });
      }
      return new Response('not found', { status: 404 });
    });

    try {
      const models = await discoverModels('p-local', true);
      expect(models[0]?.contextWindow).toBe(128000);
      expect(models[0]?.thinking?.supported).toBe(true);
      expect(fetchSpy.mock.calls.some((c) => String(c[0]).endsWith('/api/version'))).toBe(
        false
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
