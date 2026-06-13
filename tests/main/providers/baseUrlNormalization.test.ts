/**
 * Locks the store-side base-URL normalization. The renderer's
 * `describeBaseUrl` is the user-facing nudge, but the shared
 * `normalizeBaseUrl` invoked inside `providerStore.addProvider` /
 * `updateProvider` / `load()` is the safety net for:
 *
 *   - Providers persisted before the dialect-aware strip existed
 *     (one-time migration during `load()`).
 *   - PROVIDERS_UPDATE patches that overwrite `baseUrl` without going
 *     through the React form.
 *
 * Regressions covered:
 *   1. Ollama Cloud paste: `https://ollama.com/api` under
 *      `'ollama-native'` self-heals to `https://ollama.com` so the
 *      runtime doesn't double up to `…/api/api/tags`.
 *   2. OpenRouter paste:   `https://openrouter.ai/api` under `'openai'`
 *      is PRESERVED — that `/api` segment is part of the gateway path
 *      and stripping it would 404 every chat call. This is the bug
 *      the dialect-aware strip exists to fix.
 *   3. The strip is dialect-AWARE: under `'openai'` we strip `/v1`
 *      only; under `'ollama-native'` we strip `/api` only. Both
 *      dialects can persist `/api` and `/v1` literal path segments
 *      legitimately when they are NOT trailing.
 */

import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { safeStorage } from 'electron';
import {
  addProvider,
  listProviders,
  updateProvider
} from '@main/providers/providerStore';

beforeAll(() => {
  vi.spyOn(safeStorage, 'isEncryptionAvailable').mockReturnValue(true);
});

beforeEach(() => {
  // Each test adds providers with fresh UUIDs and only inspects those
  // by id — no cross-contamination via the module-level cache.
});

describe('providerStore base-URL normalization', () => {
  it('strips a trailing /api on add (Ollama Cloud paste)', async () => {
    const p = await addProvider({
      name: 'Ollama Cloud',
      baseUrl: 'https://ollama.com/api',
      apiKey: 'k',
      dialect: 'ollama-native'
    });
    expect(p.baseUrl).toBe('https://ollama.com');
  });

  it('strips a trailing /v1 on add (OpenAI paste)', async () => {
    const p = await addProvider({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test'
    });
    expect(p.baseUrl).toBe('https://api.openai.com');
  });

  it('strips a trailing /api/ (slash-form) on ollama-native', async () => {
    // Under the dialect-aware rule `/api` is the Ollama-native suffix.
    // Cloud and local daemons both legitimately serve their native
    // surface under `/api`, so a paste of `https://example.com/api/`
    // for the native dialect must be normalized.
    const p = await addProvider({
      name: 'X',
      baseUrl: 'https://example.com/api/',
      apiKey: 'k',
      dialect: 'ollama-native'
    });
    expect(p.baseUrl).toBe('https://example.com');
  });

  it('preserves a trailing /api on the openai dialect (OpenRouter regression)', async () => {
    // The bug this test guards: under the old dialect-blind strip,
    // `https://openrouter.ai/api` was eagerly normalized to
    // `https://openrouter.ai`, then `streamOpenAi` posted to
    // `https://openrouter.ai/v1/chat/completions` and 404'd every
    // chat call. Under the dialect-aware rule the `/api` segment is
    // preserved (we strip only `/v1` for the OpenAI dialect), so the
    // runtime correctly hits `https://openrouter.ai/api/v1/...`.
    const p = await addProvider({
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api',
      apiKey: 'sk-or-test',
      dialect: 'openai'
    });
    expect(p.baseUrl).toBe('https://openrouter.ai/api');
  });

  it('strips a trailing /v1 even on a base that already contains /api (OpenRouter)', async () => {
    // A user who pastes the longer form `https://openrouter.ai/api/v1`
    // (lifted from a code snippet) should land on the canonical
    // `https://openrouter.ai/api` so the runtime can still append
    // `/v1/chat/completions`.
    const p = await addProvider({
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-or-test',
      dialect: 'openai'
    });
    expect(p.baseUrl).toBe('https://openrouter.ai/api');
  });

  it('leaves clean URLs alone', async () => {
    const p = await addProvider({
      name: 'Y',
      baseUrl: 'https://api.example.com',
      apiKey: 'k'
    });
    expect(p.baseUrl).toBe('https://api.example.com');
  });

  it('strips again on update (defense-in-depth for IPC patches, ollama-native)', async () => {
    const p = await addProvider({
      name: 'Z',
      baseUrl: 'https://example.com',
      apiKey: 'k',
      dialect: 'ollama-native'
    });
    const updated = (await updateProvider(p.id, {
      baseUrl: 'https://new.example.com/api'
    })).provider;
    expect(updated.baseUrl).toBe('https://new.example.com');
    // listProviders should reflect the same.
    const stored = (await listProviders()).find((x) => x.id === p.id);
    expect(stored?.baseUrl).toBe('https://new.example.com');
  });

  it('strips on update against the post-patch dialect (dialect swap)', async () => {
    // Edge case: a single update that swaps `dialect` AND `baseUrl`
    // must normalize against the NEW dialect, not the old one. A
    // record originally `'openai'` at `https://openrouter.ai/api` that
    // the user accidentally retypes as `https://ollama.com/api` while
    // also flipping to `'ollama-native'` should land at
    // `https://ollama.com` — the post-patch dialect's strip rule wins.
    const p = await addProvider({
      name: 'flip',
      baseUrl: 'https://openrouter.ai/api',
      apiKey: 'k',
      dialect: 'openai'
    });
    expect(p.baseUrl).toBe('https://openrouter.ai/api');
    const flipped = (await updateProvider(p.id, {
      baseUrl: 'https://ollama.com/api',
      dialect: 'ollama-native'
    })).provider;
    expect(flipped.baseUrl).toBe('https://ollama.com');
    expect(flipped.dialect).toBe('ollama-native');
  });

  it('clears cached models when baseUrl changes', async () => {
    const p = await addProvider({
      name: 'Local',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      dialect: 'openai'
    });
    await updateProvider(p.id, {
      models: [{ id: 'llama3' }],
      lastDiscoveredAt: Date.now()
    });
    const changed = (await updateProvider(p.id, {
      baseUrl: 'http://localhost:1234'
    })).provider;
    expect(changed.baseUrl).toBe('http://localhost:1234');
    expect(changed.models).toEqual([]);
    expect(changed.lastDiscoveredAt).toBeUndefined();
  });

  it('does not strip mid-path segments — only TRAILING dialect suffix', async () => {
    // A provider that legitimately serves under `/api/v3` should keep
    // its full path under either dialect.
    const p = await addProvider({
      name: 'Custom',
      baseUrl: 'https://gateway.example.com/proxy/api/v3',
      apiKey: 'k'
    });
    // The trailing match is `/v3` which is not in the strip set, so
    // the whole path is preserved.
    expect(p.baseUrl).toBe('https://gateway.example.com/proxy/api/v3');
  });
});
