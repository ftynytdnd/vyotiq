/**
 * Cross-provider "thinking effort" resolution (2026).
 *
 * Docs:
 *   - OpenAI reasoning: https://developers.openai.com/api/docs/guides/reasoning
 *   - Anthropic adaptive: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
 *   - Gemini thinking: https://ai.google.dev/gemini-api/docs/thinking
 *   - DeepSeek thinking: https://api-docs.deepseek.com/guides/thinking_mode
 *   - Ollama thinking: https://docs.ollama.com/capabilities/thinking
 *
 * A single normalized {@link ThinkingEffort} knob is stored per model on
 * the provider record (`ProviderConfig.modelThinking[modelId]`). This
 * module is the single source of truth for capability detection, UI
 * levels, wire mapping, and resolution precedence.
 */

import type { ProviderConfig, ProviderDialect, ThinkingEffort } from '../types/provider.js';

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
 * DeepSeek V4 family is ALWAYS in thinking mode unless explicitly
 * disabled, and rejects forced/required `tool_choice` while thinking.
 */
export function isDeepSeekThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!id.includes('deepseek')) return false;
  return id.includes('v4') || id.includes('reasoner');
}

function isGemini25Model(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes('2.5') || id.includes('2-5');
}

function isGemini3Model(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return /gemini-3|gemini3/.test(id) && !isGemini25Model(modelId);
}

/** Ollama models that accept `think: "low"|"medium"|"high"` (not just boolean). */
export function ollamaSupportsThinkLevels(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes('gpt-oss');
}

/**
 * Whether the model should expose thinking-effort controls in Settings
 * or the composer picker. Non-capable models remain selectable; they
 * simply hide the effort UI.
 */
export function isThinkingCapableModel(
  dialect: ProviderDialect | undefined,
  modelId: string
): boolean {
  const id = modelId.toLowerCase();
  switch (dialect ?? 'openai') {
    case 'openai':
      if (isDeepSeekThinkingModel(modelId)) return true;
      if (/gpt-5|gpt5/.test(id)) return true;
      if (/^o[134]/.test(id) || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4'))
        return true;
      if (id.includes('grok') && (id.includes('reason') || id.includes('think'))) return true;
      return false;
    case 'anthropic-native':
      if (!id.startsWith('claude-')) return false;
      if (
        id.startsWith('claude-haiku-3') ||
        id.startsWith('claude-haiku-3.5') ||
        id.startsWith('claude-instant-')
      ) {
        return false;
      }
      return (
        id.includes('opus') ||
        id.includes('sonnet') ||
        id.includes('haiku-4') ||
        id.includes('mythos')
      );
    case 'gemini-native':
      return isGemini25Model(modelId) || isGemini3Model(modelId) || /gemini.*thinking/.test(id);
    case 'ollama-native':
      return (
        id.includes('deepseek-r1') ||
        id.includes('deepseek-v3.1') ||
        id.includes('qwen3') ||
        id.includes('qwen-3') ||
        id.includes('gpt-oss') ||
        /(^|[-_/])r1($|[-_/])/.test(id) ||
        id.includes('thinking')
      );
    default:
      return false;
  }
}

/**
 * Effort levels the UI should expose for a dialect/model. Empty when the
 * model is not thinking-capable. Always includes `off` when non-empty.
 */
export function supportedThinkingEfforts(
  dialect: ProviderDialect | undefined,
  modelId: string
): ThinkingEffort[] {
  if (!isThinkingCapableModel(dialect, modelId)) return [];
  switch (dialect ?? 'openai') {
    case 'openai':
      return isDeepSeekThinkingModel(modelId)
        ? ['off', 'low', 'medium', 'high', 'xhigh']
        : ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    case 'anthropic-native':
      return ['off', 'low', 'medium', 'high', 'xhigh'];
    case 'gemini-native':
      return ['off', 'minimal', 'low', 'medium', 'high'];
    case 'ollama-native':
      return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  }
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
 *   4. `undefined` → omit wire fields (Gemini 2.5 streamer may inject dynamic budget)
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
  dialect: ProviderDialect | undefined,
  modelId: string,
  effort: ThinkingEffort | undefined
): boolean {
  if ((dialect ?? 'openai') !== 'openai') return false;
  if (!isDeepSeekThinkingModel(modelId)) return false;
  return effort !== 'off';
}

/**
 * OpenAI-compatible `reasoning_effort` (or `null` to omit). DeepSeek maps
 * `xhigh` → `max`; generic OpenAI passes `xhigh` through.
 */
export function mapOpenAiReasoningEffort(
  effort: ThinkingEffort | undefined,
  modelId?: string
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
      return modelId && isDeepSeekThinkingModel(modelId) ? 'max' : 'xhigh';
  }
}

export function mapDeepSeekThinking(
  effort: ThinkingEffort | undefined
): { type: 'enabled' | 'disabled' } {
  return { type: effort === 'off' ? 'disabled' : 'enabled' };
}

export function mapAnthropicThinking(
  modelId: string,
  effort: ThinkingEffort | undefined,
  maxTokens: number,
  defaultMaxTokens: number
): {
  config: Record<string, unknown>;
  effortField?: 'low' | 'medium' | 'high' | 'xhigh';
} | null {
  if (effort === undefined || effort === 'off') return null;
  const id = modelId.toLowerCase();
  if (
    id.startsWith('claude-haiku-3') ||
    id.startsWith('claude-haiku-3.5') ||
    id.startsWith('claude-instant-')
  ) {
    return null;
  }
  const isAdaptive =
    id.startsWith('claude-opus-4-7') ||
    id.startsWith('claude-opus-4-8') ||
    id.startsWith('claude-opus-4-6') ||
    id.startsWith('claude-sonnet-4-6') ||
    id.startsWith('claude-mythos-');
  if (isAdaptive) {
    const effortField =
      effort === 'minimal'
        ? 'low'
        : effort === 'xhigh'
          ? 'xhigh'
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
 * omit. Does NOT apply Gemini 2.5 dynamic default — see
 * `resolveGeminiThinkingConfig`.
 */
export function mapGeminiThinkingConfig(
  modelId: string,
  effort: ThinkingEffort | undefined
): Record<string, unknown> | null {
  if (effort === undefined) return null;
  const isLegacy = isGemini25Model(modelId);
  if (isLegacy) {
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
 * effort is unset on 2.5 models.
 */
export function resolveGeminiThinkingConfig(
  modelId: string,
  effort: ThinkingEffort | undefined
): Record<string, unknown> | null {
  if (effort === undefined && isGemini25Model(modelId)) {
    return { thinkingBudget: -1 };
  }
  return mapGeminiThinkingConfig(modelId, effort);
}

export type OllamaThinkWire = boolean | 'low' | 'medium' | 'high';

/**
 * Ollama `think` field. Returns `undefined` when the caller should omit
 * the body field (unset effort = provider default).
 */
export function mapOllamaThink(effort: ThinkingEffort | undefined, modelId: string): OllamaThinkWire | undefined {
  if (effort === undefined) return undefined;
  if (effort === 'off') return false;
  if (ollamaSupportsThinkLevels(modelId)) {
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
