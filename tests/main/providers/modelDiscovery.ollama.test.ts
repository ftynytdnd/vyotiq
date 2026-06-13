/**
 * Locks dialect-aware discovery routing.
 *
 *   - `ollama-native` providers must hit `GET {baseUrl}/api/tags` and
 *     map the documented Ollama tags response into `ModelInfo[]`.
 *   - `openai` providers continue to hit `GET {baseUrl}/v1/models`
 *     unchanged.
 *   - `detectDialect` must return `'openai'` when /v1/models 200s, and
 *     fall back to `'ollama-native'` when /v1/models 404s but
 *     /api/tags 200s. If neither responds, it must throw.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const persisted = {
  id: 'p1',
  name: 'Ollama Cloud',
  baseUrl: 'https://ollama.com',
  dialect: 'ollama-native' as const,
  enabled: true,
  models: [],
  lastDiscoveredAt: undefined,
  apiKey: 'k-test'
};

vi.mock('@main/providers/providerStore', () => ({
  getProviderWithKey: vi.fn(async () => persisted),
  updateProvider: vi.fn(async () => persisted)
}));

import { detectDialect, discoverModels } from '@main/providers/modelDiscovery';

interface MockFetchCall {
  url: string;
  init?: RequestInit;
}

function mockFetchSequence(steps: Array<(call: MockFetchCall) => Response | Promise<Response>>) {
  const calls: MockFetchCall[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const step = steps[Math.min(i, steps.length - 1)]!;
    i += 1;
    return step(call);
  });
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return { fn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

beforeEach(() => {
  vi.resetModules();
});

describe('discoverModels — ollama-native dialect', () => {
  it('hits /api/tags and maps the documented response', async () => {
    const { calls } = mockFetchSequence([
      () =>
        jsonResponse(200, {
          models: [
            {
              name: 'llama3.2:latest',
              model: 'llama3.2:latest',
              details: { family: 'llama', parameter_size: '3.2B' }
            },
            {
              name: 'gpt-oss:120b-cloud',
              model: 'gpt-oss:120b-cloud',
              details: { family: 'gpt-oss', parameter_size: '120B' }
            }
          ]
        })
    ]);

    const models = await discoverModels('p1', true);

    expect(calls[0]!.url).toBe('https://ollama.com/api/tags');
    expect(calls.filter((c) => c.url.endsWith('/api/show')).length).toBe(2);
    expect(models.map((m) => m.id)).toEqual([
      'gpt-oss:120b-cloud',
      'llama3.2:latest'
    ]);
    // parameter_size becomes part of the label (informational only).
    expect(models[0]!.label).toContain('120B');
    // Without a successful /api/show probe, context stays undefined.
    expect(models[0]!.contextWindow).toBeUndefined();
  });

  it('forwards the API key as a Bearer token (cloud auth)', async () => {
    const { calls } = mockFetchSequence([
      () => jsonResponse(200, { models: [] })
    ]);
    await discoverModels('p1', true);
    const auth = (calls[0]!.init?.headers as Record<string, string>)['Authorization'];
    expect(auth).toBe('Bearer k-test');
  });

  it('throws ProviderError(endpoint-missing) on 404 from /api/tags', async () => {
    // Discovery surface: a 404 means the BASE URL is wrong (the
    // daemon doesn't expose /api/tags at all), not that a specific
    // model is missing. Renderer can show a single-line "Endpoint
    // not found. Verify the Base URL and dialect" instead of dumping
    // the raw 404 body.
    mockFetchSequence([
      () =>
        new Response('not found', {
          status: 404,
          statusText: 'Not Found'
        })
    ]);
    await expect(discoverModels('p1', true)).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'endpoint-missing',
      status: 404,
      surface: 'discovery'
    });
  });

  it('throws ProviderError(auth) on 401 from /api/tags (bad key)', async () => {
    mockFetchSequence([
      () =>
        new Response('unauthorized', {
          status: 401,
          statusText: 'Unauthorized'
        })
    ]);
    await expect(discoverModels('p1', true)).rejects.toMatchObject({
      name: 'ProviderError',
      kind: 'auth',
      status: 401,
      surface: 'discovery'
    });
  });
});

describe('detectDialect — auto-probe', () => {
  it('returns "openai" when /v1/models is reachable', async () => {
    // Audit fix M-11: detectDialect now races the OpenAI and
    // Ollama-native probes in parallel via `Promise.any`, so both
    // fetches fire even when the OpenAI probe wins. The test
    // provides a fallback ollama-native stub (whose response is
    // never the winner) and asserts that AT LEAST one call hit
    // `/v1/models` rather than a strict "only one call" check —
    // the change brings the worst-case wall-clock on unreachable
    // endpoints from 2×budget down to ~1×budget.
    const { calls } = mockFetchSequence([
      () => jsonResponse(200, { data: [] }),
      () => new Response('not found', { status: 404, statusText: 'Not Found' })
    ]);
    const dialect = await detectDialect('https://api.example.com', '');
    expect(dialect).toBe('openai');
    const openaiCalls = calls.filter((c) => c.url.includes('/v1/models'));
    expect(openaiCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to "ollama-native" when /v1/models is 404 but /api/tags is 200 (non-well-known host)', async () => {
    // Phase 8/9 (2026): well-known hosts short-circuit via `classifyKnownHost`.
    // All other hosts race four dialect probes in parallel (2026 audit).
    const { calls } = mockFetchSequence([
      (call) =>
        call.url.includes('/api/tags')
          ? jsonResponse(200, { models: [] })
          : new Response('not found', { status: 404, statusText: 'Not Found' })
    ]);
    const dialect = await detectDialect('http://localhost:11434', 'k');
    expect(dialect).toBe('ollama-native');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.some((c) => c.url.includes('/v1/models'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/api/tags'))).toBe(true);
  });

  it('short-circuits to "ollama-native" for Ollama Cloud without probing', async () => {
    // Phase 8/9 (2026): `https://ollama.com` is in the well-known
    // host table, so detectDialect returns the dialect directly
    // without any HTTP traffic — saves a roundtrip per add and
    // avoids the false-negative outcome where a transient 5xx on
    // ollama.com pushes the user through the probe race and
    // persists a wrong dialect.
    const { calls } = mockFetchSequence([]);
    const dialect = await detectDialect('https://ollama.com', 'k');
    expect(dialect).toBe('ollama-native');
    expect(calls).toHaveLength(0);
  });

  it('short-circuits to "anthropic-native" for api.anthropic.com without probing', async () => {
    // Phase 8 (2026) — same well-known short-circuit, Anthropic side.
    const { calls } = mockFetchSequence([]);
    const dialect = await detectDialect('https://api.anthropic.com', 'sk-ant-…');
    expect(dialect).toBe('anthropic-native');
    expect(calls).toHaveLength(0);
  });

  it('short-circuits to "gemini-native" for generativelanguage.googleapis.com without probing', async () => {
    // Phase 9 (2026) — same well-known short-circuit, Gemini side.
    const { calls } = mockFetchSequence([]);
    const dialect = await detectDialect(
      'https://generativelanguage.googleapis.com',
      'AIza…'
    );
    expect(dialect).toBe('gemini-native');
    expect(calls).toHaveLength(0);
  });

  it('throws when neither endpoint is reachable', async () => {
    mockFetchSequence([
      () => new Response('nope', { status: 404 })
    ]);
    await expect(detectDialect('https://broken.example', '')).rejects.toThrow(
      /Could not detect dialect/
    );
  });

  it('continues to /api/tags even if /v1/models throws (DNS / TCP reset)', async () => {
    mockFetchSequence([
      (call) => {
        if (call.url.includes('/api/tags')) return jsonResponse(200, { models: [] });
        throw new Error('ECONNREFUSED');
      }
    ]);
    const dialect = await detectDialect('http://localhost:11434', '');
    expect(dialect).toBe('ollama-native');
  });

  it('normalizes a trailing /api on the user-supplied base URL before probing (self-hosted)', async () => {
    // Regression (originally for Ollama Cloud): PROVIDERS_ADD ran
    // `detectDialect(rawUrl, …)` BEFORE any normalization had a
    // chance to remove a trailing dialect suffix. So a user pasting
    // `<host>/api` got probed and persisted with mismatched URLs.
    // The current dialect-aware path normalizes the probe URL
    // against EACH dialect:
    //
    //   - OpenAI probe URL: `normalizeBaseUrl(raw, 'openai')` strips
    //     only `/v1`, so `<host>/api` is preserved and the probe
    //     goes to `<host>/api/v1/models`. This 404s on a native-
    //     only daemon, which is exactly what we want — the probe
    //     falls through to:
    //   - Ollama-native probe URL: `normalizeBaseUrl(raw,
    //     'ollama-native')` strips `/api`, so the probe goes to
    //     `<host>/api/tags` (the canonical native endpoint), which
    //     returns 200 and locks the dialect.
    //
    // The "doubled `/api/api`" bug the old path was vulnerable to
    // is structurally impossible with the dialect-aware rule.
    //
    // Phase 8/9 (2026): we use a self-hosted host (`ollama.local`)
    // instead of `ollama.com` to bypass the well-known short-circuit
    // and actually exercise the probe race.
    const { calls } = mockFetchSequence([
      () => new Response('not found', { status: 404, statusText: 'Not Found' }),
      () => jsonResponse(200, { models: [] })
    ]);
    const dialect = await detectDialect('https://ollama.local/api', 'k');
    expect(dialect).toBe('ollama-native');
    expect(calls[0]!.url).toBe('https://ollama.local/api/v1/models');
    expect(calls[1]!.url).toBe('https://ollama.local/api/tags');
  });

  it('preserves a trailing /api on the OpenAI probe (OpenRouter regression)', async () => {
    // OpenRouter exposes its OpenAI-compat surface under
    // `https://openrouter.ai/api`. The probe must NOT strip `/api` —
    // the canonical models endpoint is `…/api/v1/models`. The old
    // dialect-blind probe stripped to `https://openrouter.ai` and
    // 404'd before the dialect could ever resolve to `'openai'`.
    //
    // Audit fix M-11: parallel probes mean the ollama-native fetch
    // also fires; provide a fallback stub and assert the OpenAI
    // probe URL by FILTER rather than positional index.
    const { calls } = mockFetchSequence([
      () => jsonResponse(200, { data: [{ id: 'openai/gpt-4o', context_length: 128000 }] }),
      () => new Response('not found', { status: 404, statusText: 'Not Found' })
    ]);
    const dialect = await detectDialect('https://openrouter.ai/api', 'sk-or-test');
    expect(dialect).toBe('openai');
    const openaiCall = calls.find((c) => c.url.includes('/v1/models'));
    expect(openaiCall?.url).toBe('https://openrouter.ai/api/v1/models');
  });

  it('normalizes a trailing /v1 on the user-supplied base URL before probing', async () => {
    // Audit fix M-11: parallel probes; provide fallback stub.
    const { calls } = mockFetchSequence([
      () => jsonResponse(200, { data: [] }),
      () => new Response('not found', { status: 404, statusText: 'Not Found' })
    ]);
    const dialect = await detectDialect('https://api.example.com/v1', 'k');
    expect(dialect).toBe('openai');
    const openaiCall = calls.find((c) => c.url.includes('/v1/models'));
    expect(openaiCall?.url).toBe('https://api.example.com/v1/models');
  });

  /**
   * Regression — Cluster 2 audit. All detectDialect probes must
   * forward an AbortSignal so a base URL that DNS-resolves but never
   * responds at the socket layer cannot hang PROVIDERS_ADD past the
   * `MODEL_DISCOVERY_TIMEOUT_MS` budget.
   */
  it('forwards a bounded AbortSignal on every probe fetch (timeout wiring)', async () => {
    const { calls } = mockFetchSequence([
      (call) =>
        call.url.includes('/api/tags')
          ? jsonResponse(200, { models: [] })
          : new Response('not found', { status: 404 })
    ]);
    await detectDialect('https://maybe-broken.example', '');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      const sig = c.init?.signal;
      expect(sig).toBeDefined();
      expect(typeof (sig as AbortSignal).aborted).toBe('boolean');
    }
  });
});
