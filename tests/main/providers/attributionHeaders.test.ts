/**
 * Locks the OpenRouter app-attribution header resolver. The contract
 * is small but high-stakes: getting it wrong either silently leaks
 * the project's default identity onto unrelated providers or wipes
 * out the user's per-provider override. The renderer's
 * `AttributionSection` UI relies on each rule below to render its
 * placeholder hints correctly.
 *
 * Reference: https://openrouter.ai/docs/api-reference/overview#headers
 */

import { describe, expect, it } from 'vitest';
import {
  buildAttributionHeaders,
  describeAttributionDefaults
} from '@main/providers/attributionHeaders';
import type { ProviderWithKey } from '@shared/types/provider.js';

function provider(overrides: Partial<ProviderWithKey>): ProviderWithKey {
  return {
    id: 'p1',
    name: 'test',
    baseUrl: 'https://api.openai.com',
    apiKey: 'sk-test',
    enabled: true,
    dialect: 'openai',
    ...overrides
  } as ProviderWithKey;
}

describe('buildAttributionHeaders', () => {
  it('attaches both default headers when host is openrouter.ai and no override is set', () => {
    const h = buildAttributionHeaders(
      provider({ baseUrl: 'https://openrouter.ai/api' })
    );
    expect(h['HTTP-Referer']).toBe('https://vyotiq.app');
    expect(h['X-OpenRouter-Title']).toBe('Vyotiq');
  });

  it('also recognizes the www. variant of the OpenRouter host', () => {
    const h = buildAttributionHeaders(
      provider({ baseUrl: 'https://www.openrouter.ai/api' })
    );
    expect(h['HTTP-Referer']).toBe('https://vyotiq.app');
    expect(h['X-OpenRouter-Title']).toBe('Vyotiq');
  });

  it('returns an empty object for non-OpenRouter hosts when no override is set', () => {
    expect(buildAttributionHeaders(provider({ baseUrl: 'https://api.openai.com' }))).toEqual({});
    expect(buildAttributionHeaders(provider({ baseUrl: 'http://localhost:11434' }))).toEqual({});
    expect(buildAttributionHeaders(provider({ baseUrl: 'https://api.deepseek.com' }))).toEqual({});
  });

  it('user override wins over the host-aware default (OpenRouter)', () => {
    const h = buildAttributionHeaders(
      provider({
        baseUrl: 'https://openrouter.ai/api',
        attribution: { referer: 'https://acme.example', title: 'AcmeBot' }
      })
    );
    expect(h['HTTP-Referer']).toBe('https://acme.example');
    expect(h['X-OpenRouter-Title']).toBe('AcmeBot');
  });

  it('user override is the ONLY way to attach attribution to a non-OpenRouter host', () => {
    // A power user pointing at a self-hosted gateway that proxies to
    // OpenRouter wants attribution to flow through. They supply an
    // explicit override; the host check still allows it.
    const h = buildAttributionHeaders(
      provider({
        baseUrl: 'https://gateway.example.com',
        attribution: { referer: 'https://app.example', title: 'AppX' }
      })
    );
    expect(h['HTTP-Referer']).toBe('https://app.example');
    expect(h['X-OpenRouter-Title']).toBe('AppX');
  });

  it('empty-string override suppresses just that one header (Referer only)', () => {
    const h = buildAttributionHeaders(
      provider({
        baseUrl: 'https://openrouter.ai/api',
        // `referer: ''` ⇒ explicit opt-out. `title` field absent ⇒
        // the default applies for that header only.
        attribution: { referer: '' }
      })
    );
    expect(h['HTTP-Referer']).toBeUndefined();
    expect(h['X-OpenRouter-Title']).toBe('Vyotiq');
  });

  it('empty-string override suppresses just that one header (Title only)', () => {
    const h = buildAttributionHeaders(
      provider({
        baseUrl: 'https://openrouter.ai/api',
        attribution: { title: '' }
      })
    );
    expect(h['HTTP-Referer']).toBe('https://vyotiq.app');
    expect(h['X-OpenRouter-Title']).toBeUndefined();
  });

  it('partially-overridden attribution leaves the other field on default', () => {
    const h = buildAttributionHeaders(
      provider({
        baseUrl: 'https://openrouter.ai/api',
        attribution: { title: 'CustomBot' }
      })
    );
    expect(h['HTTP-Referer']).toBe('https://vyotiq.app');
    expect(h['X-OpenRouter-Title']).toBe('CustomBot');
  });

  it('returns a fresh object each call (callers spread the result)', () => {
    const a = buildAttributionHeaders(provider({ baseUrl: 'https://openrouter.ai/api' }));
    const b = buildAttributionHeaders(provider({ baseUrl: 'https://openrouter.ai/api' }));
    expect(a).not.toBe(b);
  });

  it('treats malformed base URLs as non-OpenRouter (defensive)', () => {
    // The persisted store would never store a URL like this, but the
    // resolver must not throw.
    expect(buildAttributionHeaders(provider({ baseUrl: 'not a url' }))).toEqual({});
  });
});

describe('describeAttributionDefaults', () => {
  it('reports the canonical defaults so the UI can mirror what is sent', () => {
    expect(describeAttributionDefaults('https://openrouter.ai/api')).toEqual({
      referer: 'https://vyotiq.app',
      title: 'Vyotiq',
      appliesToHost: true
    });
  });

  it('flags non-OpenRouter hosts as not applying to defaults', () => {
    expect(describeAttributionDefaults('https://api.openai.com')).toMatchObject({
      appliesToHost: false
    });
  });
});
