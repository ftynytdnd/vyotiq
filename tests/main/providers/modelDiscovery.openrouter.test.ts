/**
 * Locks the OpenAI-dialect `/v1/models` parser against the real
 * OpenRouter response shape. The shape carries fields beyond what
 * canonical OpenAI emits (`name`, `pricing`, `architecture`,
 * `top_provider`, `supported_parameters`); the parser must:
 *
 *   1. Consume the `data: [...]` envelope.
 *   2. Use `id` as the route slug (`openai/gpt-4o`) — that's what
 *      the chat client posts back to `/v1/chat/completions`.
 *   3. Surface the human-friendly `name` ("OpenAI: GPT-4o") on
 *      `ModelInfo.label` so the dropdown can render the prettier
 *      form when one is available.
 *   4. Read `context_length` into `ModelInfo.contextWindow` (so the
 *      composer's token gauge works without the user pinning an
 *      override).
 *   5. Silently ignore the extra fields.
 *   6. Attach OpenRouter app-attribution headers to the discovery
 *      request (proves the wire-up — fetchOpenAiModels merges
 *      `buildAttributionHeaders` into the request headers).
 *
 * The parser is exercised through the public `discoverModels` entry
 * point — that's the same path the renderer's "Refresh /v1/models"
 * button hits, so the test guards the user-visible behavior.
 */

import { describe, expect, it, vi, beforeAll } from 'vitest';
import { safeStorage } from 'electron';
import { addProvider } from '@main/providers/providerStore';
import { discoverModels } from '@main/providers/modelDiscovery';

beforeAll(() => {
  vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true);
});

const SAMPLE_OPENROUTER_RESPONSE = {
  data: [
    {
      id: 'openai/gpt-4o',
      name: 'OpenAI: GPT-4o',
      context_length: 128000,
      // Extra OpenRouter-specific fields we silently ignore.
      pricing: { prompt: '0.0000025', completion: '0.00001' },
      architecture: { modality: 'text->text', tokenizer: 'GPT' },
      top_provider: { context_length: 128000, max_completion_tokens: 16384 },
      supported_parameters: ['temperature', 'tools', 'response_format', 'reasoning']
    },
    {
      id: 'vendor/null-ctx',
      name: 'Null Ctx',
      context_length: null,
      top_provider: { context_length: 65536 }
    },
    {
      id: 'anthropic/claude-sonnet-4',
      name: 'Anthropic: Claude Sonnet 4',
      context_length: 200000,
      pricing: { prompt: '0.000003', completion: '0.000015' }
    },
    {
      // Edge case: id == name (some shims). Label should NOT be set
      // because that would just duplicate the id in the dropdown.
      id: 'meta-llama/llama-3.1-8b',
      name: 'meta-llama/llama-3.1-8b',
      context_length: 131072
    }
  ]
};

describe('discoverModels (OpenRouter shape)', () => {
  it('parses OpenRouter /v1/models with extra fields and attaches attribution headers', async () => {
    const captured: Array<{ url: string; headers: Headers }> = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const headers = new Headers(init?.headers);
        captured.push({ url, headers });
        return new Response(JSON.stringify(SAMPLE_OPENROUTER_RESPONSE), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      });

    try {
      const created = await addProvider({
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api',
        apiKey: 'sk-or-test',
        dialect: 'openai'
      });

      // `addProvider` triggers no fetch on its own; `discoverModels`
      // is the entry point under test.
      const models = await discoverModels(created.id, true);

      // Shape assertions.
      expect(models).toHaveLength(4);
      const gpt = models.find((m) => m.id === 'openai/gpt-4o');
      expect(gpt).toBeDefined();
      expect(gpt?.contextWindow).toBe(128000);
      expect(gpt?.label).toBe('OpenAI: GPT-4o');
      expect(gpt?.pricing?.inputPerMillion).toBeCloseTo(2.5, 4);
      expect(gpt?.pricing?.outputPerMillion).toBeCloseTo(10, 4);
      expect(gpt?.supportedParameters).toContain('reasoning');
      expect(gpt?.thinking?.supported).toBe(true);
      expect(gpt?.thinking?.wireStyle).toBe('openai-reasoning');

      const sonnet = models.find((m) => m.id === 'anthropic/claude-sonnet-4');
      expect(sonnet?.contextWindow).toBe(200000);
      expect(sonnet?.label).toBe('Anthropic: Claude Sonnet 4');

      const llama = models.find((m) => m.id === 'meta-llama/llama-3.1-8b');
      // id === name ⇒ no redundant label.
      expect(llama?.label).toBeUndefined();
      expect(llama?.contextWindow).toBe(131072);

      const nullCtx = models.find((m) => m.id === 'vendor/null-ctx');
      expect(nullCtx?.contextWindow).toBe(65536);

      // Attribution + auth wiring.
      // The probe URL must be the dialect-aware form — `/api` preserved.
      const discoveryCall = captured.find((c) =>
        c.url === 'https://openrouter.ai/api/v1/models'
      );
      expect(discoveryCall).toBeDefined();
      expect(discoveryCall?.headers.get('Authorization')).toBe('Bearer sk-or-test');
      expect(discoveryCall?.headers.get('HTTP-Referer')).toBe('https://vyotiq.app');
      expect(discoveryCall?.headers.get('X-OpenRouter-Title')).toBe('Vyotiq');

      // Default sort is alphabetical by id, so the assertion above is
      // also a regression for the sort order:
      expect(models.map((m) => m.id)).toEqual([
        'anthropic/claude-sonnet-4',
        'meta-llama/llama-3.1-8b',
        'openai/gpt-4o',
        'vendor/null-ctx'
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('parses OpenAI extended model rows (features / groups)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'o4-mini',
              features: ['streaming', 'reasoning_effort'],
              groups: ['reasoning']
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    try {
      const created = await addProvider({
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        dialect: 'openai'
      });
      const models = await discoverModels(created.id, true);
      expect(models[0]?.thinking?.supported).toBe(true);
      expect(models[0]?.thinking?.wireStyle).toBe('openai-reasoning');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('does NOT attach attribution headers when host is non-OpenRouter', async () => {
    const captured: Array<{ url: string; headers: Headers }> = [];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const headers = new Headers(init?.headers);
        captured.push({ url, headers });
        return new Response(
          JSON.stringify({ data: [{ id: 'gpt-4o', context_length: 128000 }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

    try {
      const created = await addProvider({
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        dialect: 'openai'
      });

      await discoverModels(created.id, true);
      const call = captured.find((c) => c.url === 'https://api.openai.com/v1/models');
      expect(call).toBeDefined();
      expect(call?.headers.get('HTTP-Referer')).toBeNull();
      expect(call?.headers.get('X-OpenRouter-Title')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
