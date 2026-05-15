/**
 * AI Provider types. Vyotiq supports two wire dialects:
 *
 *   - `openai`         : OpenAI-compatible REST surface — `/v1/models` +
 *                        `/v1/chat/completions` with SSE streaming.
 *                        Used by OpenAI, DeepSeek, Groq, Together, vLLM,
 *                        LM Studio, and local Ollama's OpenAI shim.
 *
 *   - `ollama-native`  : Ollama's native REST surface — `/api/tags` +
 *                        `/api/chat` with NDJSON streaming. REQUIRED for
 *                        Ollama Cloud (`https://ollama.com`), which does
 *                        NOT expose `/v1/*` at all. Also works against
 *                        any local Ollama daemon (`http://localhost:11434`).
 *
 * The dialect is locked in at provider add-time via auto-detect (see
 * `providers/modelDiscovery.ts :: detectDialect`). Once set, the chat
 * client routes to the matching streamer so the orchestrator loop above
 * sees a single, dialect-agnostic `ChatStreamDelta` shape.
 */

/** Wire dialects supported by the chat client. */
export type ProviderDialect = 'openai' | 'ollama-native';

/** Stable list of dialect values, in UI display order. */
export const PROVIDER_DIALECTS: readonly ProviderDialect[] = [
  'openai',
  'ollama-native'
] as const;

/** Short, user-facing labels for the dialect switch in settings. */
export const PROVIDER_DIALECT_LABELS: Record<ProviderDialect, string> = {
  'openai': 'OpenAI-compatible',
  'ollama-native': 'Ollama native'
};

export interface ProviderConfig {
  /** Stable internal id. */
  id: string;
  /** User-facing label, e.g. "OpenAI", "Local Ollama". */
  name: string;
  /** Base URL WITHOUT trailing slash. e.g. `https://api.openai.com` or `http://localhost:11434`. */
  baseUrl: string;
  /**
   * Wire dialect. Optional for backward-compat with providers persisted
   * before this field existed — callers must treat `undefined` as `'openai'`.
   * New providers always persist an explicit value (locked in by
   * auto-detect on add).
   */
  dialect?: ProviderDialect;
  /** Whether the provider is enabled in model selectors. */
  enabled: boolean;
  /** Optional notes shown in settings. */
  notes?: string;
  /** Cached discovered models. */
  models?: ModelInfo[];
  /** Last-discovery timestamp (ms epoch). */
  lastDiscoveredAt?: number;
  /**
   * User-supplied context-window overrides, keyed by `modelId`. Wins over
   * the value discovered via `/v1/models`. Unit is tokens. Used when the
   * upstream provider (OpenAI, Anthropic, DeepSeek direct) doesn't expose
   * `context_length` on its `/v1/models` response, or when the user wants
   * to pin a specific ceiling regardless of what the router reports.
   */
  contextOverrides?: Record<string, number>;
  /**
   * Optional attribution headers attached to outbound requests. Currently
   * meaningful only for OpenRouter — its public rankings page credits
   * the calling app via `HTTP-Referer` and `X-OpenRouter-Title` (see
   * https://openrouter.ai/docs/api-reference/overview#headers). Both
   * fields are optional individually:
   *
   *   - `undefined`     ⇒ host-aware defaults apply (auto-attribute when
   *                       host is `openrouter.ai`).
   *   - `''` (empty)    ⇒ explicit opt-out for that single header.
   *   - `'<value>'`     ⇒ user override; sent verbatim.
   *
   * The field is stored alongside the rest of the persisted record (it
   * is non-secret), but the resolved header values are computed at send
   * time by `attributionHeaders.buildAttributionHeaders` so we never
   * persist resolved defaults — that way changing the project's
   * canonical homepage / app name later is a one-liner.
   */
  attribution?: ProviderAttribution;
}

/**
 * App-attribution overrides for OpenRouter-style headers. See
 * `ProviderConfig.attribution` for the resolution semantics.
 */
export interface ProviderAttribution {
  /** Maps to the `HTTP-Referer` request header. */
  referer?: string;
  /** Maps to the `X-OpenRouter-Title` request header (canonical name). */
  title?: string;
}

/** As returned by GET /v1/models — minimal shape. */
export interface ModelInfo {
  id: string;
  /** Optional human label. */
  label?: string;
  /** Optional context window in tokens, if the provider exposes it. */
  contextWindow?: number;
}

/** Provider record with API key — only used in main process. */
export interface ProviderWithKey extends ProviderConfig {
  apiKey: string;
}

/** Add-provider payload from the renderer. */
export interface AddProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  notes?: string;
  /**
   * Optional dialect hint from the renderer. When omitted, the main
   * process auto-detects (probe `/v1/models`; fall back to `/api/tags`)
   * before persisting.
   */
  dialect?: ProviderDialect;
  /**
   * Optional attribution overrides set at add-time. See
   * `ProviderConfig.attribution`. Most users leave this off so the
   * host-aware defaults take effect; the field exists so the form can
   * pre-seed values (e.g. when the user already pasted a custom
   * referer) and so future preset wizards can pin attribution per
   * preset without an extra round-trip.
   */
  attribution?: ProviderAttribution;
}

/** Identifies a model selection across providers. */
export interface ModelSelection {
  providerId: string;
  modelId: string;
}
