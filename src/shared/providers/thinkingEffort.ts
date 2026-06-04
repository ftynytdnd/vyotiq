/**
 * Cross-provider "thinking effort" resolution.
 *
 * A single normalized {@link ThinkingEffort} knob is stored per model on
 * the provider record (`ProviderConfig.modelThinking[modelId]`). This
 * module is the single source of truth for:
 *
 *   1. Which effort levels the Settings UI should offer for a given
 *      dialect/model (`supportedThinkingEfforts`).
 *   2. How that normalized value maps onto each provider's wire shape
 *      (`mapOpenAiReasoningEffort`, `mapAnthropicThinking`,
 *      `mapGeminiThinkingConfig`, `mapOllamaThink`).
 *   3. Whether forcing `tool_choice` is safe for the resolved thinking
 *      state (`modelRejectsToolChoice`) — DeepSeek V4 thinking mode
 *      returns HTTP 400 for forced/required tool choice.
 *
 * Pure + dependency-free so both the main streamers and the renderer
 * Settings UI import it without pulling in Electron.
 */

import type { ProviderConfig, ProviderDialect, ThinkingEffort } from '../types/provider.js';

/** Canonical ordering, weakest → strongest. */
export const THINKING_EFFORTS: readonly ThinkingEffort[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'max'
] as const;

/** Human-facing labels for the Settings dropdown. */
export const THINKING_EFFORT_LABELS: Readonly<Record<ThinkingEffort, string>> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max'
};

/**
 * DeepSeek V4 family (`deepseek-v4-flash`, `deepseek-v4-pro`,
 * `deepseek-reasoner`) is ALWAYS in thinking mode unless explicitly
 * disabled, and thinking mode rejects forced/required `tool_choice`
 * with HTTP 400 ("Thinking mode does not support this tool_choice").
 * Detected by id stem so dated snapshots match too.
 */
export function isDeepSeekThinkingModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!id.includes('deepseek')) return false;
  return id.includes('v4') || id.includes('reasoner');
}

/**
 * Effort levels the Settings UI should expose for a dialect/model.
 * Always includes `off`. Returns the dialect's meaningful subset so we
 * never offer a level the provider would reject (e.g. OpenAI's
 * `reasoning_effort` has no `max`).
 */
export function supportedThinkingEfforts(
  dialect: ProviderDialect | undefined,
  modelId: string
): ThinkingEffort[] {
  switch (dialect ?? 'openai') {
    case 'openai':
      // DeepSeek V4 accepts high/max (low/medium map to high) and can be
      // disabled via the `thinking` body field; generic OpenAI-compat
      // reasoning models accept minimal/low/medium/high.
      return isDeepSeekThinkingModel(modelId)
        ? ['off', 'low', 'medium', 'high', 'max']
        : ['off', 'minimal', 'low', 'medium', 'high'];
    case 'anthropic-native':
      return ['off', 'low', 'medium', 'high', 'max'];
    case 'gemini-native':
      return ['off', 'minimal', 'low', 'medium', 'high'];
    case 'ollama-native':
      // Ollama's `think` flag is a boolean; we expose On/Off only.
      return ['off', 'high'];
  }
}

/**
 * Read the stored per-model effort, falling back to the legacy
 * provider-wide `anthropicThinking` flag (Anthropic dialect only) so
 * pre-existing setups keep working. Returns `undefined` when the user
 * has expressed no preference for this model.
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
 * Whether the model+effort combination forbids a forced/required
 * `tool_choice` on the wire (caller must omit the field). True only for
 * DeepSeek thinking models while thinking is active. `effort === 'off'`
 * means we send `thinking:{type:'disabled'}`, which re-enables
 * tool_choice; an undefined effort is treated as thinking-on for the
 * always-thinking DeepSeek family.
 */
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
 * OpenAI-compatible `reasoning_effort` value (or `null` to omit). OpenAI
 * accepts `minimal|low|medium|high`; `max` clamps to `high`. `off`
 * omits the field (and the caller disables DeepSeek thinking separately).
 */
export function mapOpenAiReasoningEffort(
  effort: ThinkingEffort | undefined
): 'minimal' | 'low' | 'medium' | 'high' | null {
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
    case 'max':
      return 'high';
  }
}

/**
 * DeepSeek-specific `thinking` body block. DeepSeek is always-thinking,
 * so `off` explicitly disables it (which also re-enables tool_choice);
 * any other value enables it (effort flows via `reasoning_effort`).
 */
export function mapDeepSeekThinking(
  effort: ThinkingEffort | undefined
): { type: 'enabled' | 'disabled' } {
  return { type: effort === 'off' ? 'disabled' : 'enabled' };
}

/**
 * Anthropic `thinking` block. Adaptive-tier models (Opus 4.6/4.7,
 * Sonnet 4.6, Mythos) use `{ type: 'adaptive' }`; older thinking-capable
 * models derive a `budget_tokens` from effort. Returns `null` to omit.
 */
export function mapAnthropicThinking(
  modelId: string,
  effort: ThinkingEffort | undefined,
  maxTokens: number,
  defaultMaxTokens: number
): { config: Record<string, unknown>; effortField?: 'low' | 'medium' | 'high' | 'max' } | null {
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
      effort === 'minimal' ? 'low' : effort === 'max' ? 'max' : effort;
    return { config: { type: 'adaptive' }, effortField };
  }
  const desired =
    effort === 'minimal' || effort === 'low'
      ? 2048
      : effort === 'high' || effort === 'max'
        ? 16384
        : 8192;
  const ceiling = Math.max(1024, (typeof maxTokens === 'number' ? maxTokens : defaultMaxTokens) - 1);
  return { config: { type: 'enabled', budget_tokens: Math.min(desired, ceiling) } };
}

/**
 * Gemini `thinkingConfig`. Gemini 3.x uses `thinkingLevel`; legacy 2.5
 * uses an integer `thinkingBudget` (0 disables). Returns `null` to omit.
 */
export function mapGeminiThinkingConfig(
  modelId: string,
  effort: ThinkingEffort | undefined
): Record<string, unknown> | null {
  if (effort === undefined) return null;
  const id = modelId.toLowerCase();
  const isLegacy = id.includes('2.5') || id.includes('2-5');
  if (isLegacy) {
    const budget =
      effort === 'off'
        ? 0
        : effort === 'minimal' || effort === 'low'
          ? 1024
          : effort === 'medium'
            ? 8192
            : 16384;
    return { thinkingBudget: budget };
  }
  if (effort === 'off') return { thinkingLevel: 'minimal' };
  const level = effort === 'max' ? 'high' : effort === 'minimal' ? 'minimal' : effort;
  return { thinkingLevel: level };
}

/** Ollama `think` toggle. `off` (or unset) → false; anything else → true. */
export function mapOllamaThink(effort: ThinkingEffort | undefined): boolean {
  return effort !== undefined && effort !== 'off';
}
