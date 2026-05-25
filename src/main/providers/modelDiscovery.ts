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
import { safeText as safeTextShared } from './errorBody.js';

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

  const dialect = effectiveDialect(provider);
  let models: ModelInfo[];
  switch (dialect) {
    case 'ollama-native':
      models = await fetchOllamaTags(provider);
      break;
    case 'anthropic-native':
      models = await fetchAnthropicModels(provider);
      break;
    case 'gemini-native':
      models = await fetchGeminiModels(provider);
      break;
    default:
      models = await fetchOpenAiModels(provider);
      break;
  }
  await updateProvider(providerId, { models, lastDiscoveredAt: Date.now() });
  return models;
}

/**
 * Map well-known provider hostnames to their canonical dialect, so the
 * Add-Provider auto-detect can short-circuit the parallel-probe step
 * when the user pasted an obvious URL. Hostnames are matched case-
 * insensitively against the parsed `URL.hostname`. Returns `null` for
 * any host we can't classify confidently — the caller falls through to
 * the probe race.
 *
 * Sources verified May 2026:
 *   - https://platform.claude.com/docs/en/api/models-list  (Anthropic)
 *   - https://ai.google.dev/api/models                     (Gemini)
 *   - https://ollama.com                                   (Ollama Cloud)
 *
 * Pure / synchronous; no I/O. Exported for testability.
 */
function classifyKnownHost(baseUrl: string): ProviderDialect | null {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === 'api.anthropic.com') return 'anthropic-native';
  if (host === 'generativelanguage.googleapis.com') return 'gemini-native';
  if (host === 'ollama.com' || host === 'www.ollama.com') return 'ollama-native';
  return null;
}

/**
 * Probe the provider's base URL to decide which dialect it speaks.
 *
 *   1. If the host is a well-known provider (Anthropic / Gemini /
 *      Ollama Cloud) → short-circuit to its canonical dialect (no
 *      network probe required).
 *   2. Otherwise, race `GET /v1/models` (OpenAI dialect) and
 *      `GET /api/tags` (Ollama-native dialect). First 200 wins.
 *   3. Neither reachable → throw (IPC caller logs a warn; the
 *      provider is persisted with the user-supplied hint anyway).
 *
 * Called from the PROVIDERS_ADD IPC handler only, so it's off the
 * hot path. Callers that already know the dialect (explicit hint
 * from the renderer) should skip this entirely.
 */
export async function detectDialect(
  baseUrl: string,
  apiKey: string
): Promise<ProviderDialect> {
  // Phase 8 / 9 (2026): well-known hosts skip the probe entirely.
  // Saves an HTTP roundtrip per add AND avoids the false-negative
  // outcome where a transient 5xx on the well-known host would push
  // the user through the probe race and persist a wrong dialect.
  const known = classifyKnownHost(baseUrl);
  if (known !== null) return known;
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

/**
 * Pattern-based filter for non-chat model IDs on OpenAI-compatible providers.
 *
 * OpenAI-compat `/v1/models` does not advertise capability types (unlike
 * Gemini's `supportedGenerationMethods`), so we identify non-chat surfaces
 * by well-known sub-string patterns. Conservative — only excludes IDs whose
 * primary surface is definitively NOT chat completion:
 *
 *   - embedding / reranking  (text-embedding-*, *-embed, *-rerank-*)
 *   - content moderation     (*-moderation-*)
 *   - OCR                    (*-ocr-* / *-ocr)
 *   - speech — TTS and STT   (whisper-*, tts-*, *-speech-*)
 *   - image generation       (dall-e-*, *-text-to-image*, *-image-generation*)
 *
 * Matching is case-insensitive and applied to the model's canonical `id`
 * after stripping any OpenRouter-style provider prefix
 * (e.g. `openai/text-embedding-3-small` → `text-embedding-3-small`), so the
 * prefix never interferes with the word-boundary anchors.
 *
 * Intentionally NOT filtered: vision-capable chat models (e.g.
 * `gpt-4-vision-preview`, `llama-3.2-11b-vision-instruct`, `pixtral-12b`).
 * "Vision" is a chat capability, not a separate non-chat surface.
 */
const NON_CHAT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bembed(ding)?s?\b/i,      // text-embedding-3-small, mistral-embed, *-embeddings-*
  /\bmoderation\b/i,          // text-moderation-latest, mistral-moderation-latest
  /\bocr\b/i,                 // mistral-ocr-latest, pixtral-ocr-*
  /\brerank\b/i,              // mistral-rerank-v1, cohere-rerank-*
  /\btts\b/i,                 // tts-1, tts-1-hd
  /\bwhisper\b/i,             // whisper-1, whisper-large-v3
  /\bdall-?e\b/i,             // dall-e-2, dall-e-3
  /\btext-to-image\b/i,       // OpenRouter image-gen route variants
  /\bimage-generation\b/i,    // provider-specific image-gen endpoints
  /\btranscri(pt|be)\b/i      // transcription endpoints
];

export function isNonChatModel(id: string): boolean {
  // Strip OpenRouter-style provider prefix before pattern matching so
  // `openai/text-embedding-3-small` correctly resolves to `text-embedding-3-small`.
  const tail = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  return NON_CHAT_PATTERNS.some((re) => re.test(tail));
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
      // Drop known non-chat surfaces (embeddings, moderation, OCR, etc.)
      // before they reach the model picker. OpenAI-compat `/v1/models`
      // does not carry capability metadata so we match on id patterns.
      if (isNonChatModel(id)) return null;
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

/**
 * Phase 8 (2026) — Anthropic Models API.
 *
 * `GET /v1/models` returns:
 *   {
 *     "data": [
 *       {
 *         "type": "model",
 *         "id": "claude-opus-4-7-20260101",
 *         "display_name": "Claude Opus 4.7",
 *         "created_at": "...",
 *         "max_input_tokens": 1000000,   // (when capabilities are exposed)
 *         "max_tokens": 128000,          // synchronous Messages API output cap
 *         "capabilities": { ... }
 *       },
 *       ...
 *     ],
 *     "has_more": false,
 *     "first_id": "...",
 *     "last_id": "..."
 *   }
 *
 * Fields verified May 2026 against `platform.claude.com/docs/en/api/models-list`.
 * `max_input_tokens` is exposed inconsistently across model snapshots; we
 * map it to `ModelInfo.contextWindow` when present and fall back to the
 * user override path otherwise.
 *
 * Auth: `x-api-key: <KEY>` + the mandatory `anthropic-version` header.
 */
interface RawAnthropicModel {
  type?: string;
  id?: string;
  display_name?: string;
  /** Anthropic 2026: total input-token ceiling for the model. */
  max_input_tokens?: number;
  /** Synchronous Messages API output ceiling. NOT used as `contextWindow`. */
  max_tokens?: number;
}
interface RawAnthropicModelsResponse {
  data?: RawAnthropicModel[];
  has_more?: boolean;
  /** Pagination cursor for `before_id` / `after_id`; we don't paginate yet. */
  first_id?: string;
  last_id?: string;
}

async function fetchAnthropicModels(provider: ProviderWithKey): Promise<ModelInfo[]> {
  const url = `${provider.baseUrl}/v1/models`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-api-key': provider.apiKey,
    'anthropic-version': '2023-06-01'
  };

  let res: Response;
  try {
    res = await fetchWithTimeout(url, headers);
  } catch (err: unknown) {
    throw new Error(describeNetworkError(err, url));
  }

  if (!res.ok) {
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

  const json = (await res.json()) as RawAnthropicModelsResponse;
  const list = Array.isArray(json.data) ? json.data : [];
  return list
    .map((m) => {
      const id = m.id;
      if (!id) return null;
      const info: ModelInfo = { id };
      if (typeof m.display_name === 'string' && m.display_name.length > 0 && m.display_name !== id) {
        info.label = m.display_name;
      }
      if (typeof m.max_input_tokens === 'number' && m.max_input_tokens > 0) {
        info.contextWindow = m.max_input_tokens;
      }
      return info;
    })
    .filter((m): m is ModelInfo => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Phase 9 (2026) — Gemini Models API.
 *
 * `GET /v1beta/models` returns:
 *   {
 *     "models": [
 *       {
 *         "name": "models/gemini-3.1-pro-preview",
 *         "displayName": "Gemini 3.1 Pro Preview",
 *         "description": "...",
 *         "inputTokenLimit": 1048576,
 *         "outputTokenLimit": 65536,
 *         "supportedGenerationMethods": ["generateContent", "countTokens"],
 *         ...
 *       },
 *       ...
 *     ],
 *     "nextPageToken": "..."
 *   }
 *
 * Fields verified May 2026 against `ai.google.dev/api/models`.
 *
 * We:
 *   - filter to models that support `generateContent` (skip embedding-
 *     only / TTS-only / etc. surfaces),
 *   - strip the `models/` prefix from `name` to keep canonical ids
 *     short (`gemini-3.1-pro-preview` instead of `models/gemini-3.1-pro-preview`),
 *   - map `inputTokenLimit` → `ModelInfo.contextWindow` so the composer
 *     pill shows a real ceiling out of the box (no `set ctx` CTA needed
 *     for Gemini providers).
 *
 * Auth: `x-goog-api-key: <KEY>` request header (2026 documented form).
 * The transport layer (Phase 9 streamGemini) handles the query-string
 * fallback for self-hosted proxies that strip non-allowlisted headers;
 * discovery here uses the header form unconditionally — discovery
 * failure on a header-stripping proxy surfaces a clear 401 the user
 * can troubleshoot.
 */
interface RawGeminiModel {
  name?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}
interface RawGeminiModelsResponse {
  models?: RawGeminiModel[];
  nextPageToken?: string;
}

async function fetchGeminiModels(provider: ProviderWithKey): Promise<ModelInfo[]> {
  const url = `${provider.baseUrl}/v1beta/models`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['x-goog-api-key'] = provider.apiKey;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, headers);
  } catch (err: unknown) {
    throw new Error(describeNetworkError(err, url));
  }

  if (!res.ok) {
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

  const json = (await res.json()) as RawGeminiModelsResponse;
  const list = Array.isArray(json.models) ? json.models : [];
  return list
    .map((m) => {
      const rawName = m.name;
      if (typeof rawName !== 'string' || rawName.length === 0) return null;
      // Strip the canonical `models/` prefix; keep everything after it
      // verbatim (preview / dated / image suffixes all stay).
      const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
      // Filter out non-chat surfaces. `generateContent` is the canonical
      // chat method; embedding-only / TTS-only / robotics-only models
      // declare different methods and would error on `:streamGenerateContent`.
      const methods = Array.isArray(m.supportedGenerationMethods)
        ? m.supportedGenerationMethods
        : [];
      if (methods.length > 0 && !methods.includes('generateContent')) {
        return null;
      }
      const info: ModelInfo = { id };
      if (typeof m.displayName === 'string' && m.displayName.length > 0 && m.displayName !== id) {
        info.label = m.displayName;
      }
      if (typeof m.inputTokenLimit === 'number' && m.inputTokenLimit > 0) {
        info.contextWindow = m.inputTokenLimit;
      }
      return info;
    })
    .filter((m): m is ModelInfo => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// Audit fix 2026-05-P2-1: thin wrapper around the shared `safeText`
// helper that preserves the model-discovery 500-char preview cap.
// The chat transports keep the default 1 000-char cap because their
// error bodies ("messages" arrays, validation errors) are typically
// richer than discovery's bare HTTP shape.
async function safeText(res: Response): Promise<string> {
  return safeTextShared(res, 500);
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
