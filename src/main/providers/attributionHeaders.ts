/**
 * Resolves OpenRouter-style app-attribution headers for an outbound
 * request. Used by both `streamOpenAi` (per-message chat) and
 * `fetchOpenAiModels` (per-discovery model list). The Ollama-native
 * transport does not call this — Ollama Cloud has no equivalent
 * attribution surface.
 *
 * Single source of truth for:
 *
 *   - Which header names to send. Per
 *     https://openrouter.ai/docs/api-reference/overview#headers the
 *     canonical names are `HTTP-Referer` + `X-OpenRouter-Title`. The
 *     legacy `X-Title` is still accepted by OpenRouter but the doc
 *     references the canonical form, so we send the canonical form.
 *
 *   - When to send them. ONLY when the target host is `openrouter.ai`
 *     (or when the user has explicitly stored an `attribution`
 *     override on the provider record). Sending them blindly to
 *     OpenAI / DeepSeek / Groq / etc. would be harmless (those servers
 *     reflect or ignore unknown request headers) but pointless.
 *
 *   - Per-header opt-out. The persisted shape lets a power user store
 *     `attribution: { referer: '' }` to suppress just `HTTP-Referer`
 *     while keeping the title default in place — see the
 *     `ProviderAttribution` doc on `ProviderConfig.attribution`.
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

const DEFAULT_REFERER = 'https://vyotiq.app';
const DEFAULT_TITLE = 'Vyotiq';

/**
 * Returns `true` when the resolved URL's hostname is OpenRouter's
 * (`openrouter.ai` or its `www.` variant). Used as the trigger for the
 * "auto-attribute" branch.
 */
function isOpenRouterHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'openrouter.ai' || host === 'www.openrouter.ai';
  } catch {
    // A malformed `baseUrl` would already have been rejected at
    // add-time by `describeBaseUrl`, but the runtime is defensive: we
    // treat unparseable URLs as "not OpenRouter" so we never attach
    // attribution to a request the user didn't intend.
    return false;
  }
}

/**
 * Resolves the headers to attach to an outbound request to `provider`.
 * Returns an empty object when no attribution applies — callers can
 * unconditionally spread the result.
 *
 * Resolution rules per header (Referer + Title independently):
 *
 *   1. If the provider has `attribution.<field>` set:
 *        - non-empty string ⇒ send verbatim.
 *        - empty string     ⇒ explicitly suppressed; do NOT send.
 *   2. Otherwise, if the host is OpenRouter, send the project default.
 *   3. Otherwise, do not send.
 *
 * The function never throws.
 */
export function buildAttributionHeaders(
  provider: ProviderWithKey
): Record<string, string> {
  const headers: Record<string, string> = {};
  const overrides = provider.attribution;
  const isOpenRouter = isOpenRouterHost(provider.baseUrl);

  // Referer
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, 'referer')) {
    const v = overrides.referer ?? '';
    if (v.length > 0) headers['HTTP-Referer'] = v;
    // Empty string ⇒ explicit opt-out for THIS header only.
  } else if (isOpenRouter) {
    headers['HTTP-Referer'] = DEFAULT_REFERER;
  }

  // Title
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, 'title')) {
    const v = overrides.title ?? '';
    if (v.length > 0) headers['X-OpenRouter-Title'] = v;
  } else if (isOpenRouter) {
    headers['X-OpenRouter-Title'] = DEFAULT_TITLE;
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
