/**
 * Background, cached refinement of pre-send token counts using provider
 * `count_tokens` endpoints (Anthropic, Gemini). These are FREE metadata
 * endpoints — no generation cost — but they are network round-trips, so we
 * NEVER block a send on them: callers read the most recent cached value
 * synchronously (falling back to the local heuristic) and fire a background
 * refresh whose result improves the NEXT evaluation.
 *
 * Why: `tokenCounter.ts` only has exact BPE tokenizers for the OpenAI / GPT
 * families. For Claude and Gemini it falls back to a chars/3.8 heuristic,
 * which can drift 10-20% on code / CJK / dense text — exactly the inputs that
 * matter for context-window thresholds. The provider count endpoints close
 * that gap when available.
 *
 * Zero-leak: the cache is a bounded LRU with a TTL; entries are evicted on
 * size and age. There are no timers and no per-run state retained after the
 * fetch settles.
 */

import type { ProviderWithKey } from '@shared/types/provider.js';
import { logger } from '../logging/logger.js';

const log = logger.child('providers/tokenCountRemote');

/** Max distinct (provider, model, text) counts retained. */
const CACHE_MAX_ENTRIES = 64;
/** Cached counts older than this are treated as stale and ignored. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Per-request wall-clock budget for a count call. */
const COUNT_TIMEOUT_MS = 8_000;
/** Below this many chars the heuristic is already good enough — skip the network. */
const MIN_CHARS_FOR_REMOTE = 8_000;

interface CacheEntry {
  tokens: number;
  at: number;
}

/** Insertion-ordered map → cheap LRU (delete+set on hit moves to tail). */
const cache = new Map<string, CacheEntry>();

/** In-flight keys so we never issue duplicate concurrent counts. */
const inFlight = new Set<string>();

/** FNV-1a 32-bit — fast, dependency-free fingerprint for the cache key. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Length guards against collisions where two different texts hash equal.
  return `${(h >>> 0).toString(36)}:${text.length}`;
}

function cacheKey(
  providerId: string,
  modelId: string,
  text: string,
  visionTokens = 0
): string {
  const visionSuffix = visionTokens > 0 ? `::v${visionTokens}` : '';
  return `${providerId}::${modelId}::${fingerprint(text)}${visionSuffix}`;
}

function readCache(key: string): number | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  // LRU bump.
  cache.delete(key);
  cache.set(key, entry);
  return entry.tokens;
}

function writeCache(key: string, tokens: number): void {
  cache.set(key, { tokens, at: Date.now() });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** True when the provider dialect exposes a usable count endpoint. */
export function providerSupportsRemoteCount(provider: ProviderWithKey): boolean {
  return provider.dialect === 'anthropic-native' || provider.dialect === 'gemini-native';
}

/**
 * Synchronously read a cached remote count for this exact text, if fresh.
 * Returns `undefined` when there is no fresh cached value (caller should use
 * the local heuristic and may call `refineRemoteCount` to warm the cache).
 *
 * `visionTokens` is folded into the cache key only — provider count endpoints
 * receive text-only payloads; callers add native media estimates separately.
 */
export function getCachedRemoteCount(
  providerId: string,
  modelId: string,
  text: string,
  visionTokens = 0
): number | undefined {
  return readCache(cacheKey(providerId, modelId, text, visionTokens));
}

async function fetchAnthropicCount(
  provider: ProviderWithKey,
  modelId: string,
  text: string,
  signal: AbortSignal
): Promise<number | undefined> {
  const url = `${provider.baseUrl}/v1/messages/count_tokens`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: text }]
    }),
    signal
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { input_tokens?: unknown };
  return typeof json.input_tokens === 'number' ? json.input_tokens : undefined;
}

async function fetchGeminiCount(
  provider: ProviderWithKey,
  modelId: string,
  text: string,
  signal: AbortSignal
): Promise<number | undefined> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let query = '';
  if (provider.apiKey) {
    if (provider.geminiAuthMode === 'query') {
      query = `?key=${encodeURIComponent(provider.apiKey)}`;
    } else {
      headers['x-goog-api-key'] = provider.apiKey;
    }
  }
  const url = `${provider.baseUrl}/v1beta/models/${encodeURIComponent(modelId)}:countTokens${query}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
    signal
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { totalTokens?: unknown };
  return typeof json.totalTokens === 'number' ? json.totalTokens : undefined;
}

/**
 * Fire-and-forget: refresh the cached remote count for `text`. Safe to call
 * every evaluation — it no-ops when a fresh value already exists, when a
 * count for the same key is already in flight, when the text is short, or
 * when the provider has no count endpoint. Never throws.
 *
 * `visionTokens` distinguishes multimodal prompts in the cache key; it is not
 * sent to the provider count API (text-only). Callers add it to `usedTokens`.
 */
export function refineRemoteCount(
  provider: ProviderWithKey,
  modelId: string,
  text: string,
  visionTokens = 0
): void {
  if (!providerSupportsRemoteCount(provider)) return;
  if (text.length < MIN_CHARS_FOR_REMOTE) return;
  const key = cacheKey(provider.id, modelId, text, visionTokens);
  if (inFlight.has(key)) return;
  if (readCache(key) !== undefined) return;
  inFlight.add(key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COUNT_TIMEOUT_MS);
  // Detach: the orchestrator must not await this.
  void (async () => {
    try {
      const tokens =
        provider.dialect === 'anthropic-native'
          ? await fetchAnthropicCount(provider, modelId, text, controller.signal)
          : await fetchGeminiCount(provider, modelId, text, controller.signal);
      if (typeof tokens === 'number' && tokens > 0) {
        writeCache(key, tokens);
      }
    } catch (err) {
      log.debug('remote token count failed (using heuristic)', {
        providerId: provider.id,
        modelId,
        err: err instanceof Error ? err.message : String(err)
      });
    } finally {
      clearTimeout(timer);
      inFlight.delete(key);
    }
  })();
}
