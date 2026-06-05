import { describe, expect, it, vi, beforeAll } from 'vitest';
import { safeStorage } from 'electron';
import { addProvider } from '@main/providers/providerStore';
import { discoverModels } from '@main/providers/modelDiscovery';

beforeAll(() => {
  vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true);
});

describe('discoverModels (Ollama /api/show context)', () => {
  it('reads dotted model_info context_length from /api/show', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(
          JSON.stringify({ models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/api/show') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            model_info: { 'llama.context_length': 131072 },
            capabilities: ['completion']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    });

    try {
      const created = await addProvider({
        name: 'Local Ollama',
        baseUrl: 'http://127.0.0.1:11434',
        apiKey: '',
        dialect: 'ollama-native'
      });
      const models = await discoverModels(created.id, true);
      expect(models[0]?.contextWindow).toBe(131072);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('probes /api/show for num_ctx after /api/tags', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) {
        return new Response(
          JSON.stringify({ models: [{ name: 'llama3.2:latest', model: 'llama3.2:latest' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.endsWith('/api/show') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            parameters: 'num_ctx 8192\n',
            capabilities: ['completion', 'thinking']
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    });

    try {
      const created = await addProvider({
        name: 'Local Ollama',
        baseUrl: 'http://127.0.0.1:11434',
        apiKey: '',
        dialect: 'ollama-native'
      });
      const models = await discoverModels(created.id, true);
      expect(models).toHaveLength(1);
      expect(models[0]?.contextWindow).toBe(8192);
      expect(models[0]?.thinking?.supported).toBe(true);
      expect(models[0]?.thinking?.wireStyle).toBe('ollama-boolean');
      expect(fetchSpy.mock.calls.some((c) => String(c[0]).endsWith('/api/show'))).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
