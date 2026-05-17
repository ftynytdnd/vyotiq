/**
 * Dynamic model discovery. Routes on `provider.dialect`:
 *
 *   - `'openai'` (default, incl. legacy providers with no dialect field):
 *       `GET {baseUrl}/v1/models` — OpenAI / DeepSeek / Groq / Together /
 *       vLLM / LM Studio / local Ollama's OpenAI shim.
 *
 *   - `'ollama-native'`:
 *       `GET {baseUrl}/api/tags` — Ollama Cloud (`https://ollama.com`,
 *       which does NOT expose `/v1/*` at all) and older local Ollama
 *       daemons that lack the shim.
 *
 * Local providers sometimes don't require an Authorization header, so
 * we send it only if a key was provided. Both dialects use the same
 * `Bearer` scheme so the transport code is identical.
 *
 * Dialect detection on provider-add lives in `detectDialect` below and is
 * called from `providers.ipc.ts :: PROVIDERS_ADD`. Once persisted, the
 * hot path in `discoverModels` trusts `provider.dialect` and does NOT
 * retry on a mismatched dialect — the provider would simply be flagged
 * as unreachable (same behavior as any other broken endpoint).
 */

import type { ModelInfo, ProviderDialect, ProviderWithKey } from '@shared/types/provider.js';
import { MODEL_DISCOVERY_TIMEOUT_MS, MODEL_DISCOVERY_TTL_MS } from '@shared/constants.js';
import { normalizeBaseUrl } from '@shared/providers/normalizeBaseUrl.js';
import { getProviderWithKey, updateProvider } from './providerStore.js';
import { classifyProviderError, isProviderError } from './providerError.js';
import { buildAttributionHeaders } from './attributionHeaders.js';

/**
 * GET wrapper that bounds the fetch at `MODEL_DISCOVERY_TIMEOUT_MS`.
 *
 * Without a cap, a DNS-resolvable-but-non-responsive base URL leaves
 * `PROVIDERS_ADD` / `PROVIDERS_TEST` / boot-time auto-refresh hanging
 * for the runtime's default socket timeout — minutes on Linux, ~21s
 * on Windows — and the renderer's settings modal spins indefinitely.
 * The bounded controller fires `AbortError` on timeout; callers either
 * propagate the underlying `fetch` rejection (transport-layer
 * timeouts) or let `classifyProviderError` describe the friendly
 * message for non-2xx responses.
 *
 * `AbortSignal.timeout` was avoided to keep the implementation
 * portable across runtimes that strip the static; `AbortController` +
 * `setTimeout` covers every supported electron-vite target with
 * identical semantics. The timer is cleared on every exit path so a
 * fast happy-path fetch never leaks a dangling `setTimeout`.
 */
async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODEL_DISCOVERY_TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Friendly transport-error message for a timed-out / network-failed GET. */
function describeNetworkError(err: unknown, url: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === 'AbortError') {
    return `Request to ${url} timed out after ${Math.round(MODEL_DISCOVERY_TIMEOUT_MS / 1000)}s. Check the Base URL is reachable.`;
  }
  return `Network error contacting ${url}: ${msg}`;
}

interface RawOpenAiModelsResponse {
  /**
   * Canonical OpenAI shape and the form OpenRouter, DeepSeek, Groq,
   * Together, vLLM, and LM Studio all return. OpenRouter adds extra
   * fields beyond what we read here (`name`, `pricing`, `architecture`,
   * `top_provider`, `supported_parameters`); we silently ignore them
   * — `name` is the only one we use, as a human-friendly label.
   */
  data?: Array<{
    id: string;
    /** OpenRouter / some shims expose a human-friendly display name. */
    name?: string;
    context_window?: number;
    context_length?: number;
  }>;
  /**
   * Some OpenAI-compat providers (early Ollama OpenAI shim, some vLLM
   * builds) return `models: [...]` instead of `data: [...]`. We accept
   * both here on the OpenAI path — the native Ollama shape is handled
   * separately in `fetchOllamaTags`.
   */
  models?: Array<{ id?: string; name?: string; context_length?: number }>;
}

interface RawOllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    details?: {
      family?: string;
      parameter_size?: string;
    };
  }>;
}

/** Dialect fallback for providers persisted before the field existed. */
function effectiveDialect(provider: ProviderWithKey): ProviderDialect {
  return provider.dialect ?? 'openai';
}

export async function discoverModels(providerId: string, force = false): Promise<ModelInfo[]> {
  const provider = await getProviderWithKey(providerId);
  if (!provider) throw new Error(`Provider not found: ${providerId}`);

  // Cache freshness is governed by `lastDiscoveredAt` + TTL ALONE. The
  // previous implementation also required `provider.models.length > 0`,
  // which meant a provider whose discovery legitimately returned an
  // empty list (brand-new local Ollama with nothing pulled,
  // misconfigured endpoint that returned `[]`, etc.) would re-fetch
  // `/v1/models` or `/api/tags` on EVERY call — including every app
  // boot and every renderer-driven `discoverCached`. Each call is a
  // real HTTP roundtrip; boot fan-out across N empty providers meant
  // N network calls per app start.
  //
  // `provider.models` may be `undefined` on a truly-never-discovered
  // record (legacy or test fixture). We treat that as "not cached"
  // below.
  const hasCacheEntry =
    provider.models !== undefined && provider.lastDiscoveredAt !== undefined;
  const cacheFresh =
    !force &&
    hasCacheEntry &&
    Date.now() - provider.lastDiscoveredAt! < MODEL_DISCOVERY_TTL_MS;

  if (cacheFresh) return provider.models!;

  const models =
    effectiveDialect(provider) === 'ollama-native'
      ? await fetchOllamaTags(provider)
      : await fetchOpenAiModels(provider);
  await updateProvider(providerId, { models, lastDiscoveredAt: Date.now() });
  return models;
}

/**
 * Probe the provider's base URL to decide which dialect it speaks.
 *
 *   1. Try `GET /v1/models`.        200 → `'openai'`.
 *   2. On 404, try `GET /api/tags`. 200 → `'ollama-native'`.
 *   3. Neither reachable            → throw (IPC caller logs a warn;
 *                                      the provider is persisted with
 *                                      the user-supplied hint anyway).
 *
 * Called from the PROVIDERS_ADD IPC handler only, so it's off the
 * hot path. Callers that already know the dialect (explicit hint
 * from the renderer) should skip this entirely.
 */
export async function detectDialect(
  baseUrl: string,
  apiKey: string
): Promise<ProviderDialect> {
  // Probe each dialect against the URL the persisted record would use
  // for that dialect — i.e. the dialect-aware normalization. Crucial
  // for OpenRouter: the user pastes `https://openrouter.ai/api`, the
  // OpenAI normalization keeps `/api` (it strips only `/v1` under the
  // OpenAI dialect), so the probe correctly hits
  // `https://openrouter.ai/api/v1/models` and resolves to 'openai'.
  // Under the previous dialect-blind strip, `/api` was eagerly removed
  // and the probe hit `https://openrouter.ai/v1/models` (404) — and
  // then any persisted record had the wrong base URL too.
  const openaiBase = normalizeBaseUrl(baseUrl, 'openai');
  const ollamaBase = normalizeBaseUrl(baseUrl, 'ollama-native');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  // Audit fix M-11: race the two probes in parallel instead of
  // sequentially. Previously this site awaited the OpenAI probe
  // first and only fell through to the Ollama-native probe on
  // timeout — combined worst-case wall-clock was 2 × the budget
  // (~42 s on a hung endpoint, observable as the renderer's
  // Settings → Add Provider modal spinning for over half a minute).
  //
  // Both probes are still bounded individually by
  // `MODEL_DISCOVERY_TIMEOUT_MS`; the race resolves as soon as the
  // first probe returns a 200 OK, so a healthy endpoint with the
  // OpenAI shim continues to resolve at OpenAI-probe latency. The
  // Promise.allSettled fallback handles the case where neither
  // probe got a 200 — we throw the same combined error message the
  // sequential version surfaced.
  //
  // We model each probe as a promise that:
  //   - resolves with the dialect on a 200 OK
  //   - rejects on any non-OK / network / timeout outcome
  // and feed both to `Promise.any`, which resolves with the first
  // fulfilled value. If both reject we fall through to the combined
  // error path.
  const probeOpenAi = async (): Promise<ProviderDialect> => {
    const res = await fetchWithTimeout(`${openaiBase}/v1/models`, headers);
    if (!res.ok) throw new Error(`openai probe non-OK status ${res.status}`);
    return 'openai';
  };
  const probeNative = async (): Promise<ProviderDialect> => {
    const res = await fetchWithTimeout(`${ollamaBase}/api/tags`, headers);
    if (!res.ok) throw new Error(`ollama-native probe non-OK status ${res.status}`);
    return 'ollama-native';
  };

  try {
    return await Promise.any([probeOpenAi(), probeNative()]);
  } catch {
    // Both probes rejected (Promise.any throws AggregateError). Fall
    // through to the combined-error throw below.
  }

  throw new Error(
    `Could not detect dialect: neither GET ${openaiBase}/v1/models nor GET ${ollamaBase}/api/tags responded OK within ${Math.round(MODEL_DISCOVERY_TIMEOUT_MS / 1000)}s.`
  );
}

async function fetchOpenAiModels(provider: ProviderWithKey): Promise<ModelInfo[]> {
  const url = `${provider.baseUrl}/v1/models`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    // Attribution: only attached when the host is OpenRouter (or the
    // user has stored an explicit override). Sent on discovery as well
    // as chat so OpenRouter's rankings page sees a single, consistent
    // attribution across both surfaces. See `attributionHeaders.ts`.
    ...buildAttributionHeaders(provider)
  };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, headers);
  } catch (err: unknown) {
    throw new Error(describeNetworkError(err, url));
  }

  if (!res.ok) {
    // Throw a typed `ProviderError` (surface: 'discovery') instead of
    // a raw `Error('GET … → 404 …')`. This keeps the IPC layer's log
    // line at WARN level (see `wrapIpcHandler.ts`) and lets the
    // renderer's ProviderRow render `error.friendlyMessage`
    // ("…: Endpoint not found. Verify the Base URL and dialect…")
    // instead of dumping the raw response body at the user.
    const body = await safeText(res);
    throw classifyProviderError({
      status: res.status,
      statusText: res.statusText,
      url,
      body,
      surface: 'discovery',
      providerId: provider.id,
      providerName: provider.name
    });
  }

  const json = (await res.json()) as RawOpenAiModelsResponse;
  const list = Array.isArray(json.data)
    ? json.data
    : Array.isArray(json.models)
      ? json.models
      : [];

  return list
    .map((m) => {
      // Prefer `id` (canonical, e.g. `openai/gpt-4o`); fall back to
      // `name` for shims that only emit one field. On OpenRouter both
      // are present and they differ — `id` is the route slug
      // (`openai/gpt-4o`) and `name` is the marketing label
      // (`OpenAI: GPT-4o`). We keep `id` as the routing value and
      // surface `name` as the human-friendly label so the model
      // dropdown shows the prettier form when available.
      const idCandidate = (m as { id?: string }).id;
      const nameCandidate = (m as { name?: string }).name;
      const id = idCandidate ?? nameCandidate;
      if (!id) return null;
      const ctx =
        (m as { context_window?: number }).context_window ??
        (m as { context_length?: number }).context_length;
      const info: ModelInfo = { id };
      if (
        typeof nameCandidate === 'string' &&
        nameCandidate.length > 0 &&
        nameCandidate !== id
      ) {
        info.label = nameCandidate;
      }
      if (typeof ctx === 'number') info.contextWindow = ctx;
      return info;
    })
    .filter((m): m is ModelInfo => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function fetchOllamaTags(provider: ProviderWithKey): Promise<ModelInfo[]> {
  const url = `${provider.baseUrl}/api/tags`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, headers);
  } catch (err: unknown) {
    throw new Error(describeNetworkError(err, url));
  }

  if (!res.ok) {
    // Same `ProviderError(surface:'discovery')` treatment as the OpenAI
    // fetcher — see the comment above `fetchOpenAiModels` for the why.
    const body = await safeText(res);
    throw classifyProviderError({
      status: res.status,
      statusText: res.statusText,
      url,
      body,
      surface: 'discovery',
      providerId: provider.id,
      providerName: provider.name
    });
  }

  const json = (await res.json()) as RawOllamaTagsResponse;
  const list = Array.isArray(json.models) ? json.models : [];

  return list
    .map((m) => {
      // Ollama returns both `name` (incl. tag, e.g. `llama3.2:latest`) and
      // `model` (same value in all observed responses). Prefer `model`
      // and fall back to `name` so a future daemon version that only
      // emits one field still works.
      const id = m.model ?? m.name;
      if (!id) return null;
      const info: ModelInfo = { id };
      // Ollama's /api/tags does not include context_window at all;
      // users who need a ceiling set it via `setContextOverride`.
      // `parameter_size` is informational only and shown as the label.
      const size = m.details?.parameter_size;
      if (size) info.label = `${id} · ${size}`;
      return info;
    })
    .filter((m): m is ModelInfo => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/** Lightweight connectivity test — used by the "Test" button in settings. */
export async function testProvider(providerId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const models = await discoverModels(providerId, true);
    return {
      ok: true,
      message: `Connected. Discovered ${models.length} model${models.length === 1 ? '' : 's'}.`
    };
  } catch (err: unknown) {
    // Prefer `ProviderError.friendlyMessage` so the user sees a single
    // line ("Authentication failed. Check the API key…") instead of
    // the prefixed `name + status + body` form that `Error.message`
    // carries for triage.
    if (isProviderError(err)) return { ok: false, message: err.friendlyMessage };
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
