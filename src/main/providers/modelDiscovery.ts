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

import type { ModelInfo, ModelInputModality, ProviderDialect, ProviderWithKey } from '@shared/types/provider.js';
import { MODEL_DISCOVERY_TIMEOUT_MS, MODEL_DISCOVERY_TTL_MS } from '@shared/constants.js';
import {
  contextWindowFromOllamaModelInfo,
  contextWindowFromOpenAiModelRow,
  isDeepSeekApiHost,
  mergeContextWindows,
  mergeThinkingCapabilities,
  positiveTokenCount,
  thinkingForDeepSeekApiModel,
  thinkingFromAnthropicCapabilities,
  thinkingFromGeminiModel,
  thinkingFromOllamaShow,
  thinkingFromOpenAiExtendedFields,
  thinkingFromSupportedParameters,
  inputModalitiesFromOpenAiExtendedFields
} from '@shared/providers/modelCapabilities.js';
import {
  inputModalitiesFromAnthropicModel,
  inputModalitiesFromGeminiModel,
  inputModalitiesFromOllamaShow,
  inputModalitiesFromOpenRouterArchitecture,
  resolveInputModalitiesFromDiscovery
} from '@shared/providers/visionCapabilities.js';
import { attachModelPricing } from '@shared/providers/attachModelPricing.js';
import { mergeModelPricing } from '@shared/providers/modelPricing.js';
import { modelsFingerprint } from '@shared/providers/modelsFingerprint.js';
import { attachModelContext } from '@shared/providers/attachModelContext.js';
import { contextWindowFromModelId } from '@shared/providers/contextFromModelId.js';
import { dialectHintFromHostname } from '@shared/providers/providerHostname.js';
import { DEFAULT_ANTHROPIC_BETAS } from '@shared/providers/thinkingEffort.js';

function applyResolvedInputModalities(
  info: ModelInfo,
  modelId: string,
  ...apiSources: Array<ModelInputModality[] | undefined>
): void {
  const resolved = resolveInputModalitiesFromDiscovery(modelId, ...apiSources);
  if (resolved.inputModalities) info.inputModalities = resolved.inputModalities;
  if (resolved.inputModalitiesEstimated) info.inputModalitiesEstimated = true;
}
import { isLocalProvider } from '@shared/providers/isLocalProvider.js';
import { isNvidiaIntegrateHost } from '@shared/providers/isNvidiaIntegrateHost.js';
import { classifyProviderHost } from '@shared/providers/providerHostKind.js';
import { enrichNvidiaModelsContext } from './nvidiaNgcCatalog.js';
import { enrichModelsFromModelsDev, refreshModelsDevCatalogIfStale } from './modelsDevCatalog.js';
import { normalizeBaseUrl } from '@shared/providers/normalizeBaseUrl.js';
import { getProviderWithKey, updateProvider } from './providerStore.js';
import {
  evictDiscoverInFlight,
  getDiscoverInFlight,
  setDiscoverInFlight
} from './discoverInFlight.js';
import { classifyProviderError, isProviderError, ProviderError } from './providerError.js';
import { buildAttributionHeaders, isOpenRouterHost } from './attributionHeaders.js';
import { recordProviderRateLimits } from './providerRateLimitCapture.js';
import { safeText as safeTextShared } from './errorBody.js';
import { logger } from '../logging/logger.js';

const log = logger.child('providers/discovery');

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
async function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
  init?: Omit<RequestInit, 'headers' | 'signal'>
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MODEL_DISCOVERY_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'GET',
      ...init,
      headers,
      signal: ctrl.signal
    });
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

function throwDiscoveryNetworkError(
  err: unknown,
  url: string,
  provider: { id: string; name: string; baseUrl?: string }
): never {
  const hostKind =
    typeof provider.baseUrl === 'string' && provider.baseUrl.length > 0
      ? classifyProviderHost(provider as Pick<ProviderWithKey, 'baseUrl' | 'dialect'>)
      : undefined;
  log.warn('discovery network error', {
    providerId: provider.id,
    hostKind,
    url,
    err: err instanceof Error ? err.message : String(err)
  });
  throw new ProviderError({
    kind: 'unknown',
    status: 0,
    providerId: provider.id,
    providerName: provider.name,
    friendlyMessage: `${provider.name}: ${describeNetworkError(err, url)}`,
    surface: 'discovery',
    rawBody: ''
  });
}

function throwDiscoveryHttpError(
  res: Response,
  body: string,
  url: string,
  provider: ProviderWithKey
): never {
  log.warn('discovery HTTP error', {
    providerId: provider.id,
    hostKind: classifyProviderHost(provider),
    status: res.status,
    url
  });
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
    context_window?: number | null;
    context_length?: number | null;
    supported_parameters?: string[];
    top_provider?: { context_length?: number | null };
    /** OpenRouter architecture metadata (input_modalities, etc.). */
    architecture?: { input_modalities?: string[] };
    features?: string[];
    groups?: string[];
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

  if (cacheFresh && !cachedModelsLackExpectedMetadata(provider, provider.models!)) {
    return provider.models!;
  }

  const inflight = getDiscoverInFlight<ModelInfo[]>(providerId);
  if (inflight) return inflight;

  const flight = fetchAndPersistModels(provider, providerId).finally(() => {
    if (getDiscoverInFlight(providerId) === flight) {
      evictDiscoverInFlight(providerId);
    }
  });
  setDiscoverInFlight(providerId, flight);
  return flight;
}

async function fetchAndPersistModels(
  provider: ProviderWithKey,
  providerId: string
): Promise<ModelInfo[]> {
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
    default: {
      models = await fetchOpenAiModels(provider);
      if (isNvidiaIntegrateHost(provider.baseUrl) && models.some((m) => m.contextWindow === undefined)) {
        models = await enrichNvidiaModelsContext(models);
      }
      if (isLocalProvider(provider) && models.some((m) => m.contextWindow === undefined)) {
        models = await enrichLocalModelsContext(provider, models);
      }
      // Local Ollama is often added as OpenAI dialect (`/v1/models` shim)
      // which omits context sizes. When `/api/version` responds, probe
      // `/api/show` for `num_ctx` the same way the native dialect does.
      if (models.some((m) => m.contextWindow === undefined || m.thinking === undefined)) {
        if (await ollamaShowApiAvailable(provider)) {
          models = await enrichOllamaModelsFromShow(provider, models);
        }
      }
      break;
    }
  }
  models = await enrichModelsMetadata(provider, models);
  const patch: {
    models: ModelInfo[];
    lastDiscoveredAt: number;
    anthropicBetas?: string[];
  } = { models, lastDiscoveredAt: Date.now() };
  if (
    dialect === 'anthropic-native' &&
    (!provider.anthropicBetas || provider.anthropicBetas.length === 0)
  ) {
    patch.anthropicBetas = [...DEFAULT_ANTHROPIC_BETAS];
  }
  await updateProvider(providerId, patch);
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
  return dialectHintFromHostname(baseUrl);
}

/**
 * Probe the provider's base URL to decide which dialect it speaks.
 *
 *   1. If the host is a well-known provider (Anthropic / Gemini /
 *      Ollama Cloud) → short-circuit to its canonical dialect (no
 *      network probe required).
 *   2. Otherwise, race all four dialect endpoints in parallel:
 *      `GET /v1/models` (OpenAI), `GET /api/tags` (Ollama-native),
 *      `GET /v1/models` (Anthropic-native), `GET /v1beta/models` (Gemini).
 *      First 200 wins.
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
  const anthropicBase = normalizeBaseUrl(baseUrl, 'anthropic-native');
  const geminiBase = normalizeBaseUrl(baseUrl, 'gemini-native');
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
  const probeAnthropic = async (): Promise<ProviderDialect> => {
    const anthropicHeaders: Record<string, string> = {
      Accept: 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey || 'dialect-probe'
    };
    const res = await fetchWithTimeout(`${anthropicBase}/v1/models`, anthropicHeaders);
    if (!res.ok) throw new Error(`anthropic-native probe non-OK status ${res.status}`);
    return 'anthropic-native';
  };
  const probeGemini = async (): Promise<ProviderDialect> => {
    const geminiHeaders: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) geminiHeaders['x-goog-api-key'] = apiKey;
    const res = await fetchWithTimeout(`${geminiBase}/v1beta/models`, geminiHeaders);
    if (!res.ok) throw new Error(`gemini-native probe non-OK status ${res.status}`);
    return 'gemini-native';
  };

  try {
    return await Promise.any([probeOpenAi(), probeNative(), probeAnthropic(), probeGemini()]);
  } catch {
    // Both probes rejected (Promise.any throws AggregateError). Fall
    // through to the combined-error throw below.
  }

  throw new Error(
    `Could not detect dialect: none of GET ${openaiBase}/v1/models, GET ${ollamaBase}/api/tags, GET ${anthropicBase}/v1/models, or GET ${geminiBase}/v1beta/models responded OK within ${Math.round(MODEL_DISCOVERY_TIMEOUT_MS / 1000)}s.`
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

const REASONING_DISCOVERY_PARAMETERS = new Set([
  'reasoning',
  'include_reasoning',
  'reasoning_effort',
  'thinking'
]);

/**
 * Re-fetch when a TTL-fresh cache predates capability parsing (context
 * and/or thinking metadata missing on providers that expose them).
 */
function cachedModelsLackExpectedMetadata(
  provider: ProviderWithKey,
  models: ModelInfo[]
): boolean {
  return (
    cachedModelsLackExpectedContext(provider, models) ||
    cachedModelsLackExpectedThinking(provider, models) ||
    cachedModelsLackExpectedModalities(provider, models)
  );
}

function cachedModelsLackExpectedModalities(
  provider: ProviderWithKey,
  models: ModelInfo[]
): boolean {
  if (models.length === 0) return false;
  if (models.some((m) => m.inputModalities !== undefined && m.inputModalities.length > 0)) {
    return false;
  }
  const dialect = effectiveDialect(provider);
  if (dialect === 'anthropic-native' || dialect === 'gemini-native') return true;
  if (dialect === 'ollama-native') return true;
  if (isOpenRouterHost(provider.baseUrl)) return true;
  if (classifyProviderHost(provider) === 'openai') return true;
  if (dialect === 'openai') return true;
  return false;
}

function cachedModelsLackExpectedContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): boolean {
  if (models.length === 0) return false;
  if (models.some((m) => m.contextWindow !== undefined)) return false;
  const dialect = effectiveDialect(provider);
  if (dialect === 'anthropic-native' || dialect === 'gemini-native') return true;
  if (dialect === 'ollama-native') return true;
  if (isOpenRouterHost(provider.baseUrl)) return true;
  if (isDeepSeekApiHost(provider.baseUrl)) return true;
  if (isNvidiaIntegrateHost(provider.baseUrl)) return true;
  if (classifyProviderHost(provider) === 'openai') return true;
  if (dialect === 'openai') return true;
  return false;
}

function cachedModelsLackExpectedThinking(
  provider: ProviderWithKey,
  models: ModelInfo[]
): boolean {
  if (models.length === 0) return false;
  if (models.some((m) => m.thinking?.supported)) return false;
  const dialect = effectiveDialect(provider);
  if (dialect === 'anthropic-native' || dialect === 'gemini-native') return true;
  if (dialect === 'ollama-native') return true;
  if (isDeepSeekApiHost(provider.baseUrl)) return true;
  if (isOpenRouterHost(provider.baseUrl)) {
    return models.some((m) =>
      m.supportedParameters?.some((p) => REASONING_DISCOVERY_PARAMETERS.has(p))
    );
  }
  return false;
}

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
    throwDiscoveryNetworkError(err, url, provider);
  }

  if (!res.ok) {
    // Throw a typed `ProviderError` (surface: 'discovery') instead of
    // a raw `Error('GET … → 404 …')`. This keeps the IPC layer's log
    // line at WARN level (see `wrapIpcHandler.ts`) and lets the
    // renderer's ProviderRow render `error.friendlyMessage`
    // ("…: Endpoint not found. Verify the Base URL and dialect…")
    // instead of dumping the raw response body at the user.
    const body = await safeText(res);
    throwDiscoveryHttpError(res, body, url, provider);
  }

  recordProviderRateLimits(provider.id, res.headers);

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
      const entry = m as {
        context_window?: number | null;
        context_length?: number | null;
        max_model_len?: number | null;
        max_input_tokens?: number | null;
        inputTokenLimit?: number | null;
        max_context_length?: number | null;
        supported_parameters?: string[];
        top_provider?: { context_length?: number | null };
        architecture?: { input_modalities?: string[] };
        features?: string[];
        groups?: string[];
        meta?: { context_size?: number | null; n_ctx_train?: number | null; context_length?: number | null };
      };
      const fromApi = contextWindowFromOpenAiModelRow(entry);
      const attached = attachModelContext(provider, id, fromApi);
      const ctx = mergeContextWindows(fromApi, attached.contextWindow);
      const info: ModelInfo = { id };
      if (
        typeof nameCandidate === 'string' &&
        nameCandidate.length > 0 &&
        nameCandidate !== id
      ) {
        info.label = nameCandidate;
      }
      if (ctx !== undefined) info.contextWindow = ctx;
      if (fromApi === undefined && attached.contextEstimated) {
        info.contextEstimated = true;
      }
      if (Array.isArray(entry.supported_parameters) && entry.supported_parameters.length > 0) {
        info.supportedParameters = entry.supported_parameters;
      }
      const thinking = mergeThinkingCapabilities(
        thinkingFromSupportedParameters(info.supportedParameters),
        thinkingFromOpenAiExtendedFields({
          features: entry.features,
          groups: entry.groups
        }),
        isDeepSeekApiHost(provider.baseUrl) ? thinkingForDeepSeekApiModel() : undefined
      );
      if (thinking) info.thinking = thinking;
      applyResolvedInputModalities(
        info,
        id,
        inputModalitiesFromOpenRouterArchitecture(entry.architecture),
        inputModalitiesFromOpenAiExtendedFields({
          features: entry.features,
          groups: entry.groups,
          id
        })
      );
      const pricing = attachModelPricing(provider, id, m);
      if (pricing) info.pricing = pricing;
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
    throwDiscoveryNetworkError(err, url, provider);
  }

  if (!res.ok) {
    // Same `ProviderError(surface:'discovery')` treatment as the OpenAI
    // fetcher — see the comment above `fetchOpenAiModels` for the why.
    const body = await safeText(res);
    throwDiscoveryHttpError(res, body, url, provider);
  }

  const json = (await res.json()) as RawOllamaTagsResponse;
  const list = Array.isArray(json.models) ? json.models : [];

  const tagged = list
    .map((m) => {
      // Ollama returns both `name` (incl. tag, e.g. `llama3.2:latest`) and
      // `model` (same value in all observed responses). Prefer `model`
      // and fall back to `name` so a future daemon version that only
      // emits one field still works.
      const id = m.model ?? m.name;
      if (!id) return null;
      const info: ModelInfo = { id };
      // Ollama's /api/tags does not include context_window; we probe
      // `/api/show` per model below for `num_ctx`.
      const size = m.details?.parameter_size;
      if (size) info.label = `${id} · ${size}`;
      return info;
    })
    .filter((m): m is ModelInfo => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  return enrichOllamaModelsFromShow(provider, tagged);
}

const OLLAMA_SHOW_CONCURRENCY = 4;

/** True when the base URL exposes Ollama's `/api/*` surface (incl. OpenAI shim). */
async function ollamaShowApiAvailable(provider: ProviderWithKey): Promise<boolean> {
  const url = `${provider.baseUrl}/api/version`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    return res.ok;
  } catch {
    return false;
  }
}

function parseOllamaShow(json: unknown): {
  contextWindow?: number;
  thinking?: ReturnType<typeof thinkingFromOllamaShow>;
  inputModalities?: ReturnType<typeof inputModalitiesFromOllamaShow>;
} {
  if (!json || typeof json !== 'object') return {};
  const rec = json as Record<string, unknown>;
  let contextWindow: number | undefined;
  const modelInfo = rec.model_info;
  if (modelInfo && typeof modelInfo === 'object') {
    contextWindow = contextWindowFromOllamaModelInfo(modelInfo as Record<string, unknown>);
  }
  const params = rec.parameters;
  if (contextWindow === undefined && typeof params === 'string') {
    const match = params.match(/(?:^|\n)\s*num_ctx\s+(\d+)/);
    if (match) {
      const n = parseInt(match[1]!, 10);
      if (Number.isFinite(n) && n > 0) contextWindow = n;
    }
  }
  const modelName = typeof rec.model === 'string' ? rec.model : undefined;
  const capabilities = Array.isArray(rec.capabilities)
    ? (rec.capabilities as string[])
    : undefined;
  const thinking = thinkingFromOllamaShow({
    capabilities,
    model_info:
      modelInfo && typeof modelInfo === 'object'
        ? (modelInfo as Record<string, unknown>)
        : undefined
  });
  const inputModalities = inputModalitiesFromOllamaShow({
    capabilities,
    model: modelName
  });
  return { contextWindow, thinking, inputModalities };
}

async function enrichOllamaModelsFromShow(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  if (models.length === 0) return models;
  const out = models.map((m) => ({ ...m }));
  for (let i = 0; i < out.length; i += OLLAMA_SHOW_CONCURRENCY) {
    const slice = out.slice(i, i + OLLAMA_SHOW_CONCURRENCY);
    await Promise.all(
      slice.map(async (info) => {
        const needsContext = info.contextWindow === undefined;
        const needsThinking = info.thinking === undefined;
        const needsModalities = info.inputModalities === undefined;
        if (!needsContext && !needsThinking && !needsModalities) return;
        const show = await probeOllamaModelShow(provider, info.id);
        if (needsContext && show.contextWindow !== undefined) {
          info.contextWindow = show.contextWindow;
        }
        if (needsThinking && show.thinking) info.thinking = show.thinking;
        if (needsModalities && show.inputModalities) {
          info.inputModalities = show.inputModalities;
        } else if (needsModalities) {
          applyResolvedInputModalities(info, info.id);
        }
      })
    );
  }
  return out;
}

async function probeOllamaModelShow(
  provider: ProviderWithKey,
  modelId: string
): Promise<ReturnType<typeof parseOllamaShow>> {
  const url = `${provider.baseUrl}/api/show`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers, {
      method: 'POST',
      body: JSON.stringify({ name: modelId })
    });
    if (!res.ok) return {};
    const json: unknown = await res.json();
    return parseOllamaShow(json);
  } catch {
    return {};
  }
}

type LocalServerKind =
  | 'lmstudio'
  | 'llamacpp'
  | 'sglang'
  | 'litellm'
  | 'tgi'
  | 'koboldcpp'
  | 'localai'
  | 'unknown';

/**
 * Probe local OpenAI-compatible daemons for native context metadata when
 * `/v1/models` omits it. LM Studio is checked before Ollama because some
 * LM Studio builds respond 200 to `/api/tags` with a non-Ollama body.
 */
async function enrichLocalModelsContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  if (models.length === 0) return models;

  let next = models;
  if (next.some((m) => m.contextWindow === undefined)) {
    next = await enrichLlamaSwapModelsContext(provider, next);
  }

  const kind = await detectLocalServerKind(provider);
  switch (kind) {
    case 'lmstudio':
      return enrichLmStudioModelsContext(provider, next);
    case 'llamacpp':
      return enrichLlamaCppModelsContext(provider, next);
    case 'sglang':
      return enrichSGLangModelsContext(provider, next);
    case 'litellm':
      return enrichLiteLlmModelsContext(provider, next);
    case 'tgi':
      return enrichTgiModelsContext(provider, next);
    case 'koboldcpp':
      return enrichKoboldCppModelsContext(provider, next);
    case 'localai':
      return enrichLocalAiModelsContext(provider, next);
    default:
      return next;
  }
}

async function detectLocalServerKind(provider: ProviderWithKey): Promise<LocalServerKind> {
  if (await lmStudioApiAvailable(provider)) return 'lmstudio';
  if (await localAiApiAvailable(provider)) return 'localai';
  if (await litellmApiAvailable(provider)) return 'litellm';
  if (await tgiApiAvailable(provider)) return 'tgi';
  if (await koboldCppApiAvailable(provider)) return 'koboldcpp';
  if (await llamaCppApiAvailable(provider)) return 'llamacpp';
  if (await sglangApiAvailable(provider)) return 'sglang';
  return 'unknown';
}

async function lmStudioApiAvailable(provider: ProviderWithKey): Promise<boolean> {
  for (const path of ['/api/v1/models', '/api/v0/models']) {
    const url = `${provider.baseUrl}${path}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
    try {
      const res = await fetchWithTimeout(url, headers);
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: unknown[] };
      if (!Array.isArray(json.data)) continue;
      if (json.data.some((row) => row && typeof row === 'object' && 'max_context_length' in row)) {
        return true;
      }
    } catch {
      // try next path
    }
  }
  return false;
}

async function llamaCppApiAvailable(provider: ProviderWithKey): Promise<boolean> {
  const url = `${provider.baseUrl}/props`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    if (!res.ok) return false;
    const json = (await res.json()) as {
      default_generation_settings?: { n_ctx?: number };
    };
    return positiveTokenCount(json.default_generation_settings?.n_ctx) !== undefined;
  } catch {
    return false;
  }
}

async function sglangApiAvailable(provider: ProviderWithKey): Promise<boolean> {
  const url = `${provider.baseUrl}/get_model_info`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    if (!res.ok) return false;
    const json = (await res.json()) as { context_length?: number };
    return positiveTokenCount(json.context_length) !== undefined;
  } catch {
    return false;
  }
}

type LmStudioCatalogEntry = { id: string; contextWindow: number };

async function fetchLmStudioCatalog(
  provider: ProviderWithKey
): Promise<LmStudioCatalogEntry[] | undefined> {
  for (const path of ['/api/v1/models', '/api/v0/models']) {
    const url = `${provider.baseUrl}${path}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
    try {
      const res = await fetchWithTimeout(url, headers);
      if (!res.ok) continue;
      const json = (await res.json()) as {
        data?: Array<{
          id?: string;
          max_context_length?: number;
          loaded_instances?: Array<{ config?: { context_length?: number } }>;
        }>;
      };
      if (!Array.isArray(json.data)) continue;
      const entries: LmStudioCatalogEntry[] = [];
      for (const row of json.data) {
        const id = row.id;
        if (!id) continue;
        const loaded = row.loaded_instances
          ?.map((inst) => positiveTokenCount(inst.config?.context_length))
          .find((n) => n !== undefined);
        const ctx = mergeContextWindows(
          loaded,
          positiveTokenCount(row.max_context_length)
        );
        if (ctx !== undefined) entries.push({ id, contextWindow: ctx });
      }
      if (entries.length > 0) return entries;
    } catch {
      // try next path
    }
  }
  return undefined;
}

function lmStudioModelIdVariants(modelId: string): string[] {
  const variants = new Set<string>([modelId]);
  const colon = modelId.indexOf(':');
  if (colon >= 0) variants.add(modelId.slice(0, colon));
  const slash = modelId.lastIndexOf('/');
  if (slash >= 0) variants.add(modelId.slice(slash + 1));
  return [...variants];
}

async function enrichLmStudioModelsContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  const catalog = await fetchLmStudioCatalog(provider);
  if (!catalog?.length) return models;
  const byId = new Map<string, number>();
  for (const entry of catalog) {
    byId.set(entry.id, entry.contextWindow);
    for (const variant of lmStudioModelIdVariants(entry.id)) {
      if (!byId.has(variant)) byId.set(variant, entry.contextWindow);
    }
  }
  return models.map((model) => {
    if (model.contextWindow !== undefined) return model;
    for (const variant of lmStudioModelIdVariants(model.id)) {
      const ctx = byId.get(variant);
      if (ctx !== undefined) return { ...model, contextWindow: ctx };
    }
    return model;
  });
}

async function enrichLlamaCppModelsContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  if (models.length > 1) {
    const perUpstream = await enrichLlamaSwapModelsContext(provider, models);
    if (perUpstream.some((m) => m.contextWindow !== undefined)) {
      return perUpstream;
    }
  }

  const url = `${provider.baseUrl}/props`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    if (!res.ok) return models;
    const json = (await res.json()) as {
      default_generation_settings?: { n_ctx?: number };
    };
    const ctx = positiveTokenCount(json.default_generation_settings?.n_ctx);
    if (ctx === undefined) return models;
    return models.map((model) =>
      model.contextWindow === undefined ? { ...model, contextWindow: ctx } : model
    );
  } catch {
    return models;
  }
}

async function enrichSGLangModelsContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  const url = `${provider.baseUrl}/get_model_info`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    if (!res.ok) return models;
    const json = (await res.json()) as { context_length?: number };
    const ctx = positiveTokenCount(json.context_length);
    if (ctx === undefined) return models;
    return models.map((model) =>
      model.contextWindow === undefined ? { ...model, contextWindow: ctx } : model
    );
  } catch {
    return models;
  }
}

async function enrichModelsMetadata(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  let next = models;
  if (
    next.some(
      (m) =>
        m.contextWindow === undefined ||
        m.pricing === undefined ||
        m.inputModalities === undefined
    )
  ) {
    next = await enrichModelsFromModelsDev(provider, next);
  }
  return next.map((model) => {
    let contextWindow = model.contextWindow;
    let contextEstimated = model.contextEstimated;
    let pricing = model.pricing;
    let inputModalities = model.inputModalities;
    let inputModalitiesEstimated = model.inputModalitiesEstimated;

    if (contextWindow === undefined) {
      const attached = attachModelContext(provider, model.id, undefined);
      if (attached.contextWindow !== undefined) {
        contextWindow = attached.contextWindow;
        if (attached.contextEstimated) contextEstimated = true;
      }
    }
    if (contextWindow === undefined) {
      const inferred = contextWindowFromModelId(model.id);
      if (inferred !== undefined) {
        contextWindow = inferred;
        contextEstimated = true;
      }
    }
    if (!pricing) {
      pricing = attachModelPricing(provider, model.id, undefined);
    } else {
      const hostPricing = attachModelPricing(provider, model.id, undefined);
      pricing = mergeModelPricing(pricing, hostPricing);
    }
    if (inputModalities === undefined) {
      const inferred = resolveInputModalitiesFromDiscovery(model.id);
      inputModalities = inferred.inputModalities;
      inputModalitiesEstimated = inferred.inputModalitiesEstimated;
    }

    if (
      contextWindow === model.contextWindow &&
      pricing === model.pricing &&
      contextEstimated === model.contextEstimated &&
      inputModalities === model.inputModalities &&
      inputModalitiesEstimated === model.inputModalitiesEstimated
    ) {
      return model;
    }
    return {
      ...model,
      contextWindow,
      pricing,
      contextEstimated,
      inputModalities,
      inputModalitiesEstimated
    };
  });
}

async function probeUpstreamProps(
  provider: ProviderWithKey,
  modelId: string
): Promise<number | undefined> {
  const url = `${provider.baseUrl}/upstream/${encodeURIComponent(modelId)}/props`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      default_generation_settings?: { n_ctx?: number };
      n_ctx?: number;
    };
    return mergeContextWindows(
      positiveTokenCount(json.default_generation_settings?.n_ctx),
      positiveTokenCount(json.n_ctx)
    );
  } catch {
    return undefined;
  }
}

async function enrichLlamaSwapModelsContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  const needs = models.filter((m) => m.contextWindow === undefined);
  if (needs.length === 0) return models;

  const ctxById = new Map<string, number>();
  for (const model of needs) {
    const ctx = await probeUpstreamProps(provider, model.id);
    if (ctx !== undefined) ctxById.set(model.id, ctx);
  }
  if (ctxById.size === 0) return models;

  return models.map((model) => {
    const ctx = ctxById.get(model.id);
    return ctx !== undefined ? { ...model, contextWindow: ctx } : model;
  });
}

async function litellmApiAvailable(provider: ProviderWithKey): Promise<boolean> {
  const url = `${provider.baseUrl}/model/info`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers, {
      method: 'POST',
      body: JSON.stringify({})
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { model_info?: { max_input_tokens?: number } };
    return positiveTokenCount(json.model_info?.max_input_tokens) !== undefined;
  } catch {
    return false;
  }
}

async function enrichLiteLlmModelsContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  const url = `${provider.baseUrl}/model/info`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

  const enriched: ModelInfo[] = [];
  for (const model of models) {
    if (model.contextWindow !== undefined) {
      enriched.push(model);
      continue;
    }
    try {
      const res = await fetchWithTimeout(url, headers, {
        method: 'POST',
        body: JSON.stringify({ model: model.id })
      });
      if (!res.ok) {
        enriched.push(model);
        continue;
      }
      const json = (await res.json()) as {
        model_info?: { max_input_tokens?: number; max_tokens?: number };
      };
      const ctx = mergeContextWindows(
        positiveTokenCount(json.model_info?.max_input_tokens),
        positiveTokenCount(json.model_info?.max_tokens)
      );
      enriched.push(ctx !== undefined ? { ...model, contextWindow: ctx } : model);
    } catch {
      enriched.push(model);
    }
  }
  return enriched;
}

async function tgiApiAvailable(provider: ProviderWithKey): Promise<boolean> {
  const url = `${provider.baseUrl}/info`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    if (!res.ok) return false;
    const json = (await res.json()) as { max_input_length?: number; max_total_tokens?: number };
    return (
      positiveTokenCount(json.max_input_length) !== undefined ||
      positiveTokenCount(json.max_total_tokens) !== undefined
    );
  } catch {
    return false;
  }
}

async function enrichTgiModelsContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  const url = `${provider.baseUrl}/info`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    if (!res.ok) return models;
    const json = (await res.json()) as { max_input_length?: number; max_total_tokens?: number };
    const ctx = mergeContextWindows(
      positiveTokenCount(json.max_input_length),
      positiveTokenCount(json.max_total_tokens)
    );
    if (ctx === undefined) return models;
    return models.map((model) =>
      model.contextWindow === undefined ? { ...model, contextWindow: ctx } : model
    );
  } catch {
    return models;
  }
}

async function koboldCppApiAvailable(provider: ProviderWithKey): Promise<boolean> {
  const url = `${provider.baseUrl}/api/v1/model`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    if (!res.ok) return false;
    const json = (await res.json()) as { result?: string; max_context_length?: number };
    return positiveTokenCount(json.max_context_length) !== undefined;
  } catch {
    return false;
  }
}

async function enrichKoboldCppModelsContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  const url = `${provider.baseUrl}/api/v1/model`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    if (!res.ok) return models;
    const json = (await res.json()) as { max_context_length?: number };
    const ctx = positiveTokenCount(json.max_context_length);
    if (ctx === undefined) return models;
    return models.map((model) =>
      model.contextWindow === undefined ? { ...model, contextWindow: ctx } : model
    );
  } catch {
    return models;
  }
}

async function localAiApiAvailable(provider: ProviderWithKey): Promise<boolean> {
  const url = `${provider.baseUrl}/readyz`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
  try {
    const res = await fetchWithTimeout(url, headers);
    return res.ok;
  } catch {
    return false;
  }
}

/** LocalAI omits context on `/v1/models`; fall back to Ollama-compatible `/api/show`. */
async function enrichLocalAiModelsContext(
  provider: ProviderWithKey,
  models: ModelInfo[]
): Promise<ModelInfo[]> {
  if (await ollamaShowApiAvailable(provider)) {
    return enrichOllamaModelsFromShow(provider, models);
  }
  return models;
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
  capabilities?: unknown;
}
interface RawAnthropicModelsResponse {
  data?: RawAnthropicModel[];
  has_more?: boolean;
  /** Pagination cursor for `before_id` / `after_id`; we don't paginate yet. */
  first_id?: string;
  last_id?: string;
}

async function fetchAnthropicModels(provider: ProviderWithKey): Promise<ModelInfo[]> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-api-key': provider.apiKey,
    'anthropic-version': '2023-06-01'
  };

  const list: RawAnthropicModel[] = [];
  let afterId: string | undefined;
  for (;;) {
    const url =
      afterId !== undefined
        ? `${provider.baseUrl}/v1/models?after_id=${encodeURIComponent(afterId)}`
        : `${provider.baseUrl}/v1/models`;

    let res: Response;
    try {
      res = await fetchWithTimeout(url, headers);
    } catch (err: unknown) {
      throwDiscoveryNetworkError(err, url, provider);
    }

    if (!res.ok) {
      const body = await safeText(res);
      throwDiscoveryHttpError(res, body, url, provider);
    }

    const json = (await res.json()) as RawAnthropicModelsResponse;
    const page = Array.isArray(json.data) ? json.data : [];
    list.push(...page);
    if (json.has_more && typeof json.last_id === 'string' && json.last_id.length > 0) {
      afterId = json.last_id;
      continue;
    }
    break;
  }

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
      const thinking = thinkingFromAnthropicCapabilities(m.capabilities);
      if (thinking) info.thinking = thinking;
      applyResolvedInputModalities(info, id, inputModalitiesFromAnthropicModel(m));
      const pricing = attachModelPricing(provider, id, m);
      if (pricing) info.pricing = pricing;
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
  thinking?: boolean;
  version?: string;
}
interface RawGeminiModelsResponse {
  models?: RawGeminiModel[];
  nextPageToken?: string;
}

async function fetchGeminiModels(provider: ProviderWithKey): Promise<ModelInfo[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (provider.apiKey) headers['x-goog-api-key'] = provider.apiKey;

  const list: RawGeminiModel[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const query = pageToken
      ? `?pageToken=${encodeURIComponent(pageToken)}`
      : '';
    const url = `${provider.baseUrl}/v1beta/models${query}`;

    let res: Response;
    try {
      res = await fetchWithTimeout(url, headers);
    } catch (err: unknown) {
      throwDiscoveryNetworkError(err, url, provider);
    }

    if (!res.ok) {
      const body = await safeText(res);
      throwDiscoveryHttpError(res, body, url, provider);
    }

    recordProviderRateLimits(provider.id, res.headers);

    const json = (await res.json()) as RawGeminiModelsResponse;
    const page = Array.isArray(json.models) ? json.models : [];
    list.push(...page);
    if (typeof json.nextPageToken === 'string' && json.nextPageToken.length > 0) {
      pageToken = json.nextPageToken;
      continue;
    }
    break;
  }

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
      const thinking = thinkingFromGeminiModel({
        thinking: m.thinking,
        version: m.version
      });
      if (thinking) info.thinking = thinking;
      applyResolvedInputModalities(
        info,
        id,
        inputModalitiesFromGeminiModel({ name: rawName, supportedGenerationMethods: methods })
      );
      const pricing = attachModelPricing(provider, id, m);
      if (pricing) info.pricing = pricing;
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

/**
 * Lightweight metadata refresh for active UI polling — re-enriches cached
 * models from models.dev / host tables without a full upstream fetch.
 */
export async function refreshProviderModelsMetadata(
  providerId: string
): Promise<ModelInfo[] | null> {
  const provider = await getProviderWithKey(providerId);
  if (!provider?.models?.length) return null;

  await refreshModelsDevCatalogIfStale();
  const enriched = await enrichModelsMetadata(provider, provider.models);
  const priorFp = modelsFingerprint(provider.models);
  const nextFp = modelsFingerprint(enriched);
  if (nextFp === priorFp) return null;

  await updateProvider(providerId, { models: enriched });
  log.debug('provider metadata refreshed from catalog', { providerId });
  return enriched;
}
