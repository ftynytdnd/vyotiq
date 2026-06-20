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

import type { ModelPricing } from '../providers/modelPricing.js';

/** Wire dialects supported by the chat client. */
export type ProviderDialect =
  | 'openai'
  | 'ollama-native'
  | 'anthropic-native'
  | 'gemini-native';

/** Stable list of dialect values, in UI display order. */
export const PROVIDER_DIALECTS: readonly ProviderDialect[] = [
  'openai',
  'anthropic-native',
  'gemini-native',
  'ollama-native'
] as const;

/**
 * Normalized, cross-provider "thinking effort" scale. The renderer
 * exposes only the subset each dialect/model supports (see
 * `@shared/providers/thinkingEffort.ts`); the per-dialect streamers
 * translate the normalized value into the wire shape that provider
 * understands (`reasoning_effort`, Anthropic `thinking`/`effort`,
 * Gemini `thinkingConfig`, Ollama `think`).
 *
 *   - `off`      → disable thinking where the provider allows it.
 *   - `minimal`  → smallest reasoning budget (OpenAI/Gemini only).
 *   - `low` / `medium` / `high` → graduated reasoning depth.
 *   - `xhigh`    → maximum depth (OpenAI / Anthropic / DeepSeek wire);
 *                  maps to provider-specific top tier.
 */
export type ThinkingEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * OpenAI-dialect wire transport. `auto` picks Responses for official
 * OpenAI reasoning models and Chat Completions elsewhere.
 */
export type OpenAiTransport = 'auto' | 'chat-completions' | 'responses';

export const OPENAI_TRANSPORTS: readonly OpenAiTransport[] = [
  'auto',
  'chat-completions',
  'responses'
] as const;

export const OPENAI_TRANSPORT_LABELS: Record<OpenAiTransport, string> = {
  auto: 'Auto',
  'chat-completions': 'Chat Completions',
  responses: 'Responses API'
};

/** Short, user-facing labels for the dialect switch in settings. */
export const PROVIDER_DIALECT_LABELS: Record<ProviderDialect, string> = {
  'openai': 'OpenAI-compatible',
  'anthropic-native': 'Anthropic (native)',
  'gemini-native': 'Google Gemini (native)',
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
  /**
   * OpenAI-dialect transport selection (2026). Meaningful only when
   * `dialect` is `openai` (or legacy undefined). See
   * `@shared/providers/openaiTransport.ts`.
   */
  openaiTransport?: OpenAiTransport;
  /**
   * Optional ceiling on parallel `streamChat` calls (multi-run pool).
   * When set, the host clamps model-declared `concurrency` to this value.
   */
  maxConcurrentStreams?: number;
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
  /**
   * Phase 10 (2026) — opt-in Anthropic beta headers, joined with `,`
   * and sent as `anthropic-beta` on every `/v1/messages` request.
   * Only meaningful for `anthropic-native` dialect providers; ignored
   * elsewhere. Persisted alongside the rest of the record so the
   * setting survives renderer reloads.
   *
   *   - `compact-2026-01-12`             → auto-compaction (Opus
   *                                          4.6 / Sonnet 4.6 /
   *                                          Opus 4.7).
   *   - `model-context-window-exceeded-2025-08-26` → graceful overflow
   *                                          (over-budget responses
   *                                          stop cleanly instead of
   *                                          400-ing).
   *   - Other betas can be added at the call site without a code
   *     change — the array is plumbed through verbatim.
   *
   * Stored sorted for stable diffing; the transport joins entries
   * with `,` for the header value. An empty / absent array sends no
   * beta header at all.
   */
  anthropicBetas?: string[];
  /**
   * Phase 9 (2026) — Gemini auth mode probe result. The 2026
   * documented form is the `x-goog-api-key` request header; some
   * self-hosted reverse proxies strip non-allowlisted headers, in
   * which case we fall back to `?key=` query-string auth ONCE and
   * persist the choice here so the probe doesn't repeat per call.
   * Default behaviour (`undefined`) is "try header first".
   */
  geminiAuthMode?: 'header' | 'query';
  /**
   * Phase 8 (2026) — Anthropic extended-thinking opt-in. Off by
   * default. When enabled, the `anthropic-native` transport injects a
   * `thinking` block on every `/v1/messages` request whose model id
   * matches a thinking-capable Claude model:
   *
   *   - Claude Opus 4.7 (claude-opus-4-7) → `{ type: 'adaptive' }`
   *     (manual `type: 'enabled'` returns 400 on this model)
   *   - Claude Opus 4.6 / Sonnet 4.6 → `{ type: 'adaptive' }`
   *     (manual mode is deprecated but still functional)
   *   - Claude Mythos Preview → `{ type: 'adaptive' }`
   *     (default; honors `display: 'summarized'` for streaming)
   *   - Older thinking-capable models (Sonnet 4.5, Sonnet 4, Opus 4,
   *     Haiku 4.5) → `{ type: 'enabled', budget_tokens }` derived
   *     from `effort` (low ≈ 2k, medium ≈ 8k, high ≈ 16k tokens).
   *   - Non-thinking Anthropic models (older Haiku, etc.) → no
   *     `thinking` block emitted (the field would be ignored or
   *     rejected; we omit it to be safe).
   *
   * `effort` controls thinking depth on adaptive-mode models via the
   * 2026 `effort` parameter and on legacy models via the
   * `budget_tokens` derivation above. Default `effort: 'medium'`
   * when enabled without an explicit choice.
   *
   * Ignored by every other dialect. Sources:
   *   https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking
   *   https://platform.claude.com/docs/en/docs/build-with-claude/adaptive-thinking
   */
  anthropicThinking?: {
    enabled: boolean;
    effort?: 'low' | 'medium' | 'high';
  };
  /**
   * Per-model thinking-effort overrides, keyed by `modelId`. Supersedes
   * the provider-wide `anthropicThinking` flag and works across every
   * dialect (OpenAI-compatible incl. DeepSeek, Anthropic, Gemini,
   * Ollama). A missing entry means "use the model's provider default"
   * (no thinking field sent, except for always-thinking models like
   * DeepSeek V4 which the dialect mapper handles). The normalized
   * value is translated to the provider's wire shape at send time by
   * the matching streamer — see `@shared/providers/thinkingEffort.ts`.
   *
   * Mirrors the `contextOverrides` precedent (per-model map on the
   * provider record) so the setting survives renderer reloads and is
   * scoped to the provider that actually serves the model.
   */
  modelThinking?: Record<string, ThinkingEffort>;
  /** True when a billing/admin API key is stored (value never sent to renderer). */
  hasBillingApiKey?: boolean;
}

/** Provider record with API keys — only used in main process. */
export interface ProviderWithKey extends ProviderConfig {
  apiKey: string;
  /**
   * Optional billing / admin API key for account snapshot fetchers.
   * Never exposed to the renderer.
   */
  billingApiKey?: string;
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

/** Wire shape hint discovered at model-list time (2026). */
export type ThinkingWireStyle =
  | 'openai-reasoning'
  | 'openai-deepseek'
  | 'anthropic-adaptive'
  | 'anthropic-budget'
  | 'gemini-level'
  | 'gemini-budget'
  | 'ollama-boolean'
  | 'ollama-levels';

/**
 * Thinking/reasoning capabilities parsed from upstream model-list APIs.
 * Populated during discovery — never inferred from model-id patterns.
 */
export interface ModelThinkingCapabilities {
  supported: boolean;
  /** Effort levels for UI (always includes `off` when supported). */
  efforts?: ThinkingEffort[];
  wireStyle?: ThinkingWireStyle;
  /** Model thinks by default; `off` disables (DeepSeek V4, Gemini 2.5). */
  defaultOn?: boolean;
  /** Rejects forced `tool_choice` while thinking is active. */
  rejectsToolChoice?: boolean;
  /** Map normalized `xhigh` → provider `max` on the wire. */
  mapsXhighToMax?: boolean;
}

/** Input modalities a model can accept (discovery-normalized). */
export type ModelInputModality = 'text' | 'image' | 'file' | 'video' | 'audio';

/** As returned by GET /v1/models — minimal shape. */
export interface ModelInfo {
  id: string;
  /** Optional human label. */
  label?: string;
  /** Optional context window in tokens, if the provider exposes it. */
  contextWindow?: number;
  /**
   * True when `contextWindow` was inferred from the model id (e.g. `128k`
   * suffix) rather than an authoritative API/catalog source.
   */
  contextEstimated?: boolean;
  /**
   * Per-model pricing when the upstream model list exposes it (OpenRouter,
   * some routers). Normalized to USD per million tokens.
   */
  pricing?: ModelPricing;
  /**
   * OpenRouter (and similar routers) list compatible request parameters
   * per model (`reasoning`, `include_reasoning`, etc.). Populated at
   * discovery when the upstream `/v1/models` payload includes them.
   */
  supportedParameters?: string[];
  /** Parsed thinking/reasoning metadata from the provider's model list. */
  thinking?: ModelThinkingCapabilities;
  /**
   * Input modalities from provider discovery (OpenRouter `architecture`,
   * Anthropic/Gemini/Ollama capabilities). Omitted on text-only models.
   */
  inputModalities?: ModelInputModality[];
  /**
   * True when `inputModalities` came from model-id heuristics rather than
   * provider API or models.dev catalog metadata.
   */
  inputModalitiesEstimated?: boolean;
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
  /**
   * Session/composer override for thinking effort. When set, wins over
   * `ProviderConfig.modelThinking` for that run. Omitted = use persisted
   * per-model setting or provider default (omit wire fields).
   */
  thinkingEffort?: ThinkingEffort;
}

/** Push payload when background discovery refreshes a provider's model list. */
export interface ProviderModelsUpdate {
  providerId: string;
  models: ModelInfo[];
  lastDiscoveredAt: number;
}

/** Push payload when background discovery poll failures warrant a Settings hint. */
export interface ProviderDiscoveryPollHint {
  providerId: string;
  /** Omitted when failures cleared after a successful poll. */
  hint?: string;
}
