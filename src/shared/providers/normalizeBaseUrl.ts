/**
 * Dialect-aware base-URL normalizer. Single source of truth for both:
 *
 *   - The persisted-store hardener in `providerStore.ts` (catches IPC
 *     patches and migrates legacy records on first load).
 *   - The renderer-side validator in `baseUrlValidation.ts` (the
 *     "Stripped trailing /…" hint shown live as the user types).
 *   - The pre-persist probe normalizer in `modelDiscovery.detectDialect`.
 *
 * The chat client appends a dialect-specific suffix to whatever
 * `provider.baseUrl` is persisted:
 *
 *   - `'openai'`        → appends `/v1/chat/completions` and
 *                          `/v1/models`.
 *   - `'ollama-native'` → appends `/api/chat` and `/api/tags`.
 *
 * So the suffix to strip on the way IN is the SAME suffix that dialect's
 * runtime appends on the way OUT — anything else, if pasted by the user,
 * is a legitimate path component the upstream gateway needs to receive.
 *
 * Critically, the older rule stripped BOTH `/v1` and `/api` regardless
 * of dialect. That broke OpenRouter, whose canonical base URL is
 * `https://openrouter.ai/api` (per
 * https://openrouter.ai/docs/api-reference/overview). Stripping `/api`
 * left `https://openrouter.ai`, then `streamOpenAi` posted to
 * `https://openrouter.ai/v1/chat/completions` and 404'd every request.
 *
 * Other path-bearing OpenAI-compat hosts that this rule has to keep
 * working:
 *
 *   - `https://api.groq.com/openai`             — preserved (no v1/api suffix).
 *   - `https://gateway.example.com/proxy/api/v3` — preserved (mid-path).
 *   - `https://api.openai.com/v1`               — stripped to `https://api.openai.com`.
 *   - `https://openrouter.ai/api/v1`            — stripped to `https://openrouter.ai/api`.
 *
 * Pure function. No I/O. Safe to import from main, renderer, and tests.
 */

import type { ProviderDialect } from '../types/provider.js';

/** Suffix that the chat client / discovery code will append at runtime, per dialect. */
const DIALECT_SUFFIX: Record<ProviderDialect, RegExp> = {
  // OpenAI dialect appends `/v1/...`, so strip a trailing `/v1[/]` only.
  // We MUST NOT strip `/api` here — OpenRouter's canonical base is
  // `https://openrouter.ai/api`, and that `/api` segment is part of the
  // path the upstream gateway expects.
  'openai': /\/v1\/?$/i,
  // Ollama-native appends `/api/...`, so strip a trailing `/api[/]` only.
  // We MUST NOT strip `/v1` here — a hypothetical native Ollama
  // deployment under `/v1` is non-existent today, but stripping would
  // also collide if the path ever became meaningful.
  'ollama-native': /\/api\/?$/i
};

/**
 * Returns `url` with: leading/trailing whitespace removed, the
 * dialect-specific runtime suffix removed if present, and any trailing
 * `/` removed. Idempotent.
 */
export function normalizeBaseUrl(url: string, dialect: ProviderDialect): string {
  return url
    .trim()
    .replace(DIALECT_SUFFIX[dialect], '')
    .replace(/\/+$/, '');
}

/**
 * Inverse helper for the renderer validator: returns the segment that
 * was (or would be) stripped, so the live nudge can render the exact
 * suffix in the message ("Stripped trailing /v1 …"). Returns `null`
 * when the input has no strippable suffix for the given dialect.
 */
export function describeStrippedSuffix(
  url: string,
  dialect: ProviderDialect
): { suffix: string; stripped: string } | null {
  const trimmed = url.trim();
  const match = DIALECT_SUFFIX[dialect].exec(trimmed);
  if (!match) return null;
  // `match[0]` is the full match incl. an optional trailing slash; the
  // user-facing label should be the canonical form without the slash.
  const suffix = match[0].replace(/\/$/, '');
  const stripped = trimmed.replace(DIALECT_SUFFIX[dialect], '').replace(/\/+$/, '');
  return { suffix, stripped };
}
