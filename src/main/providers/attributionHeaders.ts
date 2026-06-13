/**
 * Resolves provider-specific app-attribution + cache-hint headers for
 * an outbound request. Used by both `streamOpenAi` (per-message chat)
 * and `fetchOpenAiModels` (per-discovery model list). The Ollama-native
 * transport does not call this — Ollama Cloud has no equivalent
 * attribution surface.
 *
 * Single source of truth for:
 *
 *   - **OpenRouter app attribution** (`HTTP-Referer` +
 *     `X-OpenRouter-Title`). Per
 *     https://openrouter.ai/docs/api-reference/overview#headers the
 *     canonical names are `HTTP-Referer` + `X-OpenRouter-Title`. The
 *     legacy `X-Title` is still accepted by OpenRouter but the doc
 *     references the canonical form, so we send the canonical form.
 *
 *   - **xAI Grok 4.x prompt-cache attribution** (`x-grok-conv-id`).
 *     Per `docs.x.ai/developers/advanced-api-usage/prompt-caching`
 *     (2026), xAI performs prompt caching automatically; setting the
 *     `x-grok-conv-id` header to a stable per-conversation id
 *     maximizes the cache hit rate by binding successive turns of
 *     the same conversation to the same KV cache. We attach it for
 *     `api.x.ai` / `x.ai` hosts when the caller supplies a
 *     `conversationId`.
 *
 *   - When to send each header. ONLY when the target host matches
 *     the provider's class (OpenRouter / xAI) — sending blindly is
 *     harmless on every server we know of, but pointless.
 *
 *   - Per-header opt-out for OpenRouter attribution. The persisted
 *     `attribution` shape on `ProviderConfig` lets a power user
 *     store `attribution: { referer: '' }` to suppress just
 *     `HTTP-Referer` while keeping the title default in place.
 *
 *   - Defaults. We attribute as `Vyotiq` / `https://vyotiq.app`. The
 *     defaults live HERE so changing the project's canonical homepage
 *     or display name is a one-liner that reaches every persisted
 *     provider on next request without a migration.
 *
 * Pure: no I/O, no side effects, returns a fresh object every call so
 * callers can spread it directly into a `headers` literal without
 * worrying about shared identity.
 */

import type { ProviderWithKey } from '@shared/types/provider.js';
import { parseProviderHostname } from '@shared/providers/providerHostname.js';

const DEFAULT_REFERER = 'https://vyotiq.app';
const DEFAULT_TITLE = 'Vyotiq';

/**
 * Host class for a provider's `baseUrl`. Gates which attribution
 * headers we attach.
 *   - `openrouter` → emits `HTTP-Referer` + `X-OpenRouter-Title`.
 *   - `xai`        → emits `x-grok-conv-id` when a conversationId
 *                    is supplied (no app-attribution for xAI).
 *   - `other`      → no attribution headers.
 *
 * Match is case-insensitive on the hostname. Unparseable URLs
 * resolve to `'other'` so a malformed `baseUrl` (already rejected
 * at add-time by `describeBaseUrl`) can never accidentally trigger
 * attribution.
 */
type AttributionHost = 'openrouter' | 'xai' | 'other';

function classifyHost(baseUrl: string): AttributionHost {
  const flags = parseProviderHostname(baseUrl);
  if (flags.openrouter) return 'openrouter';
  if (flags.xai) return 'xai';
  return 'other';
}

/** True for OpenRouter hosts (`openrouter.ai`). */
export function isOpenRouterHost(baseUrl: string): boolean {
  return classifyHost(baseUrl) === 'openrouter';
}

/**
 * Optional opts the chat transport threads into the builder. Today
 * only carries the active `conversationId` (Phase 7 — 2026) so the
 * xAI branch can stamp `x-grok-conv-id`. Discovery callers
 * (`fetchOpenAiModels`) don't pass this slot.
 */
export interface AttributionHeaderOpts {
  /**
   * Stable per-conversation id. When supplied AND the target host
   * is xAI, the builder attaches `x-grok-conv-id: <conversationId>`
   * so xAI's automatic prompt cache binds successive turns of the
   * same conversation to the same KV cache. No-op for other hosts.
   */
  conversationId?: string;
}

/**
 * Resolves the headers to attach to an outbound request to `provider`.
 * Returns an empty object when no attribution applies — callers can
 * unconditionally spread the result.
 *
 * Resolution rules per header:
 *
 *   - **OpenRouter** (`HTTP-Referer` + `X-OpenRouter-Title`):
 *       1. If the provider has `attribution.<field>` set:
 *            - non-empty string ⇒ send verbatim.
 *            - empty string     ⇒ explicitly suppressed; do NOT send.
 *       2. Otherwise, if the host is OpenRouter, send the project
 *          default.
 *       3. Otherwise, do not send.
 *
 *   - **xAI** (`x-grok-conv-id`):
 *       1. Sent ONLY when the host is xAI AND a non-empty
 *          `conversationId` was passed.
 *       2. No `attribution`-shape opt-out today (the field is a
 *          cache hint, not user-visible branding); add a slot here
 *          if a future user surface needs to suppress it.
 *
 * The function never throws.
 */
export function buildAttributionHeaders(
  provider: ProviderWithKey,
  opts?: AttributionHeaderOpts
): Record<string, string> {
  const headers: Record<string, string> = {};
  const overrides = provider.attribution;
  const hostClass = classifyHost(provider.baseUrl);
  const isOpenRouter = hostClass === 'openrouter';
  const isXai = hostClass === 'xai';

  // OpenRouter — Referer
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, 'referer')) {
    const v = overrides.referer ?? '';
    if (v.length > 0) headers['HTTP-Referer'] = v;
    // Empty string ⇒ explicit opt-out for THIS header only.
  } else if (isOpenRouter) {
    headers['HTTP-Referer'] = DEFAULT_REFERER;
  }

  // OpenRouter — Title
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, 'title')) {
    const v = overrides.title ?? '';
    if (v.length > 0) headers['X-OpenRouter-Title'] = v;
  } else if (isOpenRouter) {
    headers['X-OpenRouter-Title'] = DEFAULT_TITLE;
  }

  // xAI — prompt-cache conversation id
  if (
    isXai &&
    typeof opts?.conversationId === 'string' &&
    opts.conversationId.length > 0
  ) {
    headers['x-grok-conv-id'] = opts.conversationId;
  }

  return headers;
}

/**
 * Exposed for the renderer-only attribution edit UI: returns the
 * resolved values that WOULD be sent right now, given the persisted
 * record. Lets the form render placeholders that mirror the actual
 * runtime behaviour ("currently sending Vyotiq" vs. "currently
 * suppressed"). NOT used on the hot path — the hot path goes through
 * `buildAttributionHeaders` directly.
 */
export function describeAttributionDefaults(baseUrl: string): {
  referer: string;
  title: string;
  appliesToHost: boolean;
} {
  return {
    referer: DEFAULT_REFERER,
    title: DEFAULT_TITLE,
    appliesToHost: isOpenRouterHost(baseUrl)
  };
}
