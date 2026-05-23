/**
 * Phase 7 (2026) — xAI Grok 4.x prompt-cache attribution.
 *
 * Pins the new `x-grok-conv-id` header behavior:
 *
 *   - Emitted ONLY when the host is xAI AND a non-empty
 *     `conversationId` is passed.
 *   - The plain hostname `x.ai` works alongside the standard
 *     `api.x.ai`.
 *   - No `x-grok-conv-id` on any other host (OpenAI, OpenRouter,
 *     DeepSeek, etc.) — sending it everywhere would be harmless but
 *     pointless, and the test guards against accidental drift.
 *   - The OpenRouter attribution path is unaffected (independent
 *     headers, independent host classification).
 *
 * Source: `docs.x.ai/developers/advanced-api-usage/prompt-caching`
 * (verified 2026).
 */

import { describe, expect, it } from 'vitest';
import { buildAttributionHeaders } from '@main/providers/attributionHeaders';
import type { ProviderWithKey } from '@shared/types/provider.js';

function provider(overrides: Partial<ProviderWithKey>): ProviderWithKey {
  return {
    id: 'p1',
    name: 'xai',
    baseUrl: 'https://api.x.ai/v1',
    apiKey: 'xai-test',
    enabled: true,
    dialect: 'openai',
    ...overrides
  } as ProviderWithKey;
}

describe('buildAttributionHeaders — xAI x-grok-conv-id (Phase 7)', () => {
  it('emits x-grok-conv-id for api.x.ai when conversationId is supplied', () => {
    const h = buildAttributionHeaders(
      provider({ baseUrl: 'https://api.x.ai/v1' }),
      { conversationId: 'conv-abc' }
    );
    expect(h['x-grok-conv-id']).toBe('conv-abc');
  });

  it('emits x-grok-conv-id for the bare x.ai hostname as well', () => {
    const h = buildAttributionHeaders(
      provider({ baseUrl: 'https://x.ai/v1' }),
      { conversationId: 'conv-bare' }
    );
    expect(h['x-grok-conv-id']).toBe('conv-bare');
  });

  it('omits x-grok-conv-id when conversationId is missing', () => {
    const h = buildAttributionHeaders(provider({ baseUrl: 'https://api.x.ai/v1' }));
    expect(h['x-grok-conv-id']).toBeUndefined();
  });

  it('omits x-grok-conv-id when conversationId is empty', () => {
    const h = buildAttributionHeaders(
      provider({ baseUrl: 'https://api.x.ai/v1' }),
      { conversationId: '' }
    );
    expect(h['x-grok-conv-id']).toBeUndefined();
  });

  it('does NOT emit x-grok-conv-id on OpenRouter hosts even with conversationId', () => {
    const h = buildAttributionHeaders(
      provider({ baseUrl: 'https://openrouter.ai/api' }),
      { conversationId: 'conv-abc' }
    );
    expect(h['x-grok-conv-id']).toBeUndefined();
    // OpenRouter app-attribution still flows.
    expect(h['HTTP-Referer']).toBe('https://vyotiq.app');
    expect(h['X-OpenRouter-Title']).toBe('Vyotiq');
  });

  it('does NOT emit x-grok-conv-id on OpenAI / DeepSeek hosts', () => {
    const ai = buildAttributionHeaders(
      provider({ baseUrl: 'https://api.openai.com/v1' }),
      { conversationId: 'conv-abc' }
    );
    const ds = buildAttributionHeaders(
      provider({ baseUrl: 'https://api.deepseek.com/v1' }),
      { conversationId: 'conv-abc' }
    );
    expect(ai['x-grok-conv-id']).toBeUndefined();
    expect(ds['x-grok-conv-id']).toBeUndefined();
  });

  it('emits NO headers on a malformed baseUrl + conversationId', () => {
    const h = buildAttributionHeaders(
      provider({ baseUrl: 'not a url' }),
      { conversationId: 'conv-abc' }
    );
    expect(h).toEqual({});
  });
});
