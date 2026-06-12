/**
 * Cross-provider "thinking effort" resolution (2026).
 *
 * Capability detection is driven by discovery metadata on `ModelInfo`
 * (`thinking`, `supportedParameters`) — see `modelCapabilities.ts`.
 * This module handles UI levels, wire mapping, and resolution precedence.
 *
 * Docs:
 *   - OpenAI reasoning: https://developers.openai.com/api/docs/guides/reasoning
 *   - Anthropic adaptive: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
 *   - Gemini thinking: https://ai.google.dev/gemini-api/docs/thinking
 *   - DeepSeek thinking: https://api-docs.deepseek.com/guides/thinking_mode
 *   - Ollama thinking: https://docs.ollama.com/capabilities/thinking
 */

import type {
  ModelInfo,
  ModelThinkingCapabilities,
  ProviderConfig,
  ProviderDialect,
  ThinkingEffort,
  ThinkingWireStyle
} from '../types/provider.js';
import {
  thinkingFromSupportedParameters,
  mergeThinkingCapabilities
} from './modelCapabilities.js';

export { modelIdTail } from './modelId.js';

export interface ThinkingCapabilityOptions {
  /** From discovery (`ModelInfo.supportedParameters`). */
  supportedParameters?: string[];
  /** From discovery (`ModelInfo.thinking`). */
  thinking?: ModelThinkingCapabilities;
}

/** Resolve thinking capabilities from explicit fields or supported_parameters. */
export function resolveThinkingCapabilities(
  options?: ThinkingCapabilityOptions
): ModelThinkingCapabilities | undefined {
  return mergeThinkingCapabilities(
    options?.thinking,
    thinkingFromSupportedParameters(options?.supportedParameters)
  );
}

/** True when the provider's model list declares reasoning API support. */
export function modelDeclaresReasoningSupport(
  supportedParameters: string[] | undefined
): boolean {
  return thinkingFromSupportedParameters(supportedParameters)?.supported === true;
}

/** Canonical ordering, weakest → strongest. */
export const THINKING_EFFORTS: readonly ThinkingEffort[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
] as const;

/** Legacy persisted value before the `max` → `xhigh` rename. */
export const LEGACY_THINKING_EFFORT_MAX = 'max' as const;

/** Human-facing labels for effort UI. */
export const THINKING_EFFORT_LABELS: Readonly<Record<ThinkingEffort, string>> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Xhigh'
};

/** Inline label beside a model id; omitted when effort is default (undefined). */
export function effortDisplayLabel(effort: ThinkingEffort | undefined): string | null {
  if (effort === undefined) return null;
  return THINKING_EFFORT_LABELS[effort];
}

/**
 * Normalize a persisted or IPC-supplied effort string. Maps legacy `max`
 * → `xhigh`; returns `undefined` when unrecognized.
 */
export function normalizePersistedThinkingEffort(
  raw: unknown
): ThinkingEffort | undefined {
  if (raw === LEGACY_THINKING_EFFORT_MAX) return 'xhigh';
  if (typeof raw !== 'string') return undefined;
  return (THINKING_EFFORTS as readonly string[]).includes(raw)
    ? (raw as ThinkingEffort)
    : undefined;
}

/**
 * Whether the model should expose thinking-effort controls in Settings
 * or the composer picker. Non-capable models remain selectable; they
 * simply hide the effort UI.
 */
export function isThinkingCapableModel(
  _dialect: ProviderDialect | undefined,
  _modelId: string,
  options?: ThinkingCapabilityOptions
): boolean {
  return resolveThinkingCapabilities(options)?.supported === true;
}

export function isThinkingCapableModelInfo(
  _dialect: ProviderDialect | undefined,
  model: Pick<ModelInfo, 'id' | 'supportedParameters' | 'thinking'>
): boolean {
  return isThinkingCapableModel(_dialect, model.id, {
    supportedParameters: model.supportedParameters,
    thinking: model.thinking
  });
}

function defaultEffortsForWire(wireStyle: ThinkingWireStyle | undefined): ThinkingEffort[] {
  if (wireStyle === 'openai-deepseek') {
    return ['off', 'low', 'medium', 'high', 'xhigh'];
  }
  if (wireStyle === 'anthropic-adaptive' || wireStyle === 'anthropic-budget') {
    return ['off', 'low', 'medium', 'high', 'xhigh'];
  }
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
}

/**
 * Effort levels the UI should expose for a dialect/model. Empty when the
 * model is not thinking-capable. Always includes `off` when non-empty.
 */
export function supportedThinkingEfforts(
  _dialect: ProviderDialect | undefined,
  _modelId: string,
  options?: ThinkingCapabilityOptions
): ThinkingEffort[] {
  const caps = resolveThinkingCapabilities(options);
  if (!caps?.supported) return [];
  if (caps.efforts?.length) return caps.efforts;
  return defaultEffortsForWire(caps.wireStyle);
}

/**
 * Effort for a provider stream request. `runLoop` passes the fully
 * resolved value on `ChatStreamRequest.reasoningEffort`; this fallback
 * covers direct `streamChat` callers (tests, probes).
 */
export function resolveStreamerThinkingEffort(
  provider: Pick<ProviderConfig, 'modelThinking' | 'anthropicThinking' | 'dialect'>,
  modelId: string,
  requestEffort?: ThinkingEffort
): ThinkingEffort | undefined {
  return requestEffort !== undefined ? requestEffort : resolveThinkingEffort(provider, modelId);
}

/**
 * Read stored per-model effort with legacy `anthropicThinking` fallback.
 * Does not apply composer session override — see
 * `resolveEffectiveThinkingEffort`.
 */
export function resolveThinkingEffort(
  provider: Pick<ProviderConfig, 'modelThinking' | 'anthropicThinking' | 'dialect'>,
  modelId: string
): ThinkingEffort | undefined {
  const perModel = provider.modelThinking?.[modelId];
  if (perModel) return perModel;
  if (provider.dialect === 'anthropic-native' && provider.anthropicThinking?.enabled) {
    return provider.anthropicThinking.effort ?? 'medium';
  }
  return undefined;
}

/**
 * Resolution precedence:
 *   1. Composer `selection.thinkingEffort` when set
 *   2. `provider.modelThinking[modelId]`
 *   3. Legacy `anthropicThinking` (anthropic dialect only)
 *   4. `undefined` → omit wire fields (Gemini budget models may inject dynamic default)
 */
export function resolveEffectiveThinkingEffort(
  provider: Pick<ProviderConfig, 'modelThinking' | 'anthropicThinking' | 'dialect'>,
  modelId: string,
  composerOverride?: ThinkingEffort
): ThinkingEffort | undefined {
  if (composerOverride !== undefined) return composerOverride;
  return resolveThinkingEffort(provider, modelId);
}

export function modelRejectsToolChoice(
  _dialect: ProviderDialect | undefined,
  _modelId: string,
  effort: ThinkingEffort | undefined,
  caps?: ModelThinkingCapabilities
): boolean {
  if (!caps?.rejectsToolChoice) return false;
  return effort !== 'off';
}

/** OpenRouter `reasoning` block (2026). See openrouter.ai/docs/api/reference/parameters */
export interface OpenRouterReasoningBlock {
  effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  exclude: boolean;
}

/**
 * Map normalized effort → OpenRouter's nested `reasoning` object.
 * Prefer this over flat `reasoning_effort` on OpenRouter hosts.
 */
export function mapOpenRouterReasoning(
  effort: ThinkingEffort | undefined,
  caps?: ModelThinkingCapabilities
): OpenRouterReasoningBlock | null {
  if (effort === undefined) return null;
  if (effort === 'off') return { effort: 'none', exclude: true };
  const flat = mapOpenAiReasoningEffort(effort, caps);
  if (flat === null) return null;
  if (flat === 'max') return { effort: 'xhigh', exclude: false };
  return { effort: flat, exclude: false };
}

/** When true, request reasoning traces in the OpenRouter response stream. */
export function openRouterIncludeReasoning(effort: ThinkingEffort | undefined): boolean {
  return effort !== undefined && effort !== 'off';
}

export function mapOpenAiReasoningEffort(
  effort: ThinkingEffort | undefined,
  caps?: ModelThinkingCapabilities
): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null {
  switch (effort) {
    case undefined:
    case 'off':
      return null;
    case 'minimal':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
      return caps?.mapsXhighToMax ? 'max' : 'xhigh';
  }
}

export function mapDeepSeekThinking(
  effort: ThinkingEffort | undefined
): { type: 'enabled' | 'disabled' } {
  return { type: effort === 'off' ? 'disabled' : 'enabled' };
}

export function mapAnthropicThinking(
  effort: ThinkingEffort | undefined,
  maxTokens: number,
  defaultMaxTokens: number,
  caps?: ModelThinkingCapabilities
): {
  config: Record<string, unknown>;
  effortField?: 'low' | 'medium' | 'high' | 'max';
} | null {
  if (effort === undefined || effort === 'off') return null;
  if (!caps?.supported) return null;

  if (caps.wireStyle === 'anthropic-adaptive') {
    const effortField =
      effort === 'minimal'
        ? 'low'
        : effort === 'xhigh'
          ? 'max'
          : effort;
    return { config: { type: 'adaptive' }, effortField };
  }

  const desired =
    effort === 'minimal' || effort === 'low'
      ? 2048
      : effort === 'high' || effort === 'xhigh'
        ? 16384
        : 8192;
  const ceiling = Math.max(1024, (typeof maxTokens === 'number' ? maxTokens : defaultMaxTokens) - 1);
  return { config: { type: 'enabled', budget_tokens: Math.min(desired, ceiling) } };
}

/**
 * Gemini `thinkingConfig` for an explicit user effort. Returns `null` to
 * omit. Does NOT apply Gemini budget dynamic default — see
 * `resolveGeminiThinkingConfig`.
 */
export function mapGeminiThinkingConfig(
  effort: ThinkingEffort | undefined,
  caps?: ModelThinkingCapabilities
): Record<string, unknown> | null {
  if (effort === undefined) return null;
  if (!caps?.supported) return null;

  if (caps.wireStyle === 'gemini-budget') {
    if (effort === 'off') return { thinkingBudget: 0 };
    const budget =
      effort === 'minimal' || effort === 'low'
        ? 1024
        : effort === 'medium'
          ? 8192
          : 16384;
    return { thinkingBudget: budget };
  }

  if (effort === 'off') return null;
  const level =
    effort === 'xhigh' ? 'high' : effort === 'minimal' ? 'minimal' : effort;
  return { thinkingLevel: level };
}

/**
 * Full Gemini thinking config including dynamic `thinkingBudget: -1` when
 * effort is unset on budget-style models.
 */
export function resolveGeminiThinkingConfig(
  effort: ThinkingEffort | undefined,
  caps?: ModelThinkingCapabilities
): Record<string, unknown> | null {
  if (effort === undefined && caps?.defaultOn && caps.wireStyle === 'gemini-budget') {
    return { thinkingBudget: -1 };
  }
  return mapGeminiThinkingConfig(effort, caps);
}

export type OllamaThinkWire = boolean | 'low' | 'medium' | 'high';

/**
 * Ollama `think` field. Returns `undefined` when the caller should omit
 * the body field (unset effort = provider default).
 */
export function mapOllamaThink(
  effort: ThinkingEffort | undefined,
  caps?: ModelThinkingCapabilities
): OllamaThinkWire | undefined {
  if (effort === undefined) return undefined;
  if (!caps?.supported) return undefined;
  if (effort === 'off') return false;
  if (caps.wireStyle === 'ollama-levels') {
    switch (effort) {
      case 'minimal':
      case 'low':
        return 'low';
      case 'medium':
        return 'medium';
      case 'high':
      case 'xhigh':
        return 'high';
      default:
        return 'low';
    }
  }
  return true;
}

/**
 * OpenAI Responses API `reasoning.effort`. Uses `none` instead of omitting
 * when thinking should be off. Returns `null` to omit the `reasoning`
 * block entirely (provider default).
 */
export function mapOpenAiResponsesReasoningEffort(
  effort: ThinkingEffort | undefined
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null {
  switch (effort) {
    case undefined:
      return null;
    case 'off':
      return 'none';
    case 'minimal':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
      return 'xhigh';
  }
}

/** Recommended Anthropic beta headers applied when none are configured. */
export const DEFAULT_ANTHROPIC_BETAS: readonly string[] = [
  'compact-2026-01-12',
  'model-context-window-exceeded-2025-08-26'
] as const;

/** Returns default betas when the provider has none; otherwise undefined. */
export function anthropicBetasForProvider(
  betas: string[] | undefined
): string[] | undefined {
  if (betas !== undefined && betas.length > 0) return betas;
  return [...DEFAULT_ANTHROPIC_BETAS];
}

/** Migrate `modelThinking` map values on provider load. */
export function normalizeModelThinkingMap(
  map: Record<string, ThinkingEffort | string> | undefined
): { map: Record<string, ThinkingEffort> | undefined; mutated: boolean } {
  if (!map) return { map: undefined, mutated: false };
  const out: Record<string, ThinkingEffort> = {};
  let mutated = false;
  for (const [modelId, raw] of Object.entries(map)) {
    const normalized = normalizePersistedThinkingEffort(raw);
    if (!normalized) {
      mutated = true;
      continue;
    }
    out[modelId] = normalized;
    if (raw !== normalized) mutated = true;
  }
  if (Object.keys(out).length !== Object.keys(map).length) mutated = true;
  return {
    map: Object.keys(out).length > 0 ? out : undefined,
    mutated
  };
}
