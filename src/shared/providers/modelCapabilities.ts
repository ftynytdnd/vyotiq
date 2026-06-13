/**
 * Parse upstream model-list metadata into normalized capability records (2026).
 *
 * Sources:
 *   - OpenRouter: https://openrouter.ai/docs/guides/overview/models
 *   - Anthropic: https://platform.claude.com/docs/en/api/models/list
 *   - Gemini: https://ai.google.dev/api/models
 *   - Ollama: https://docs.ollama.com/api-reference/show-model-details
 *   - DeepSeek thinking: https://api-docs.deepseek.com/guides/thinking_mode
 */

import type { ModelThinkingCapabilities, ThinkingEffort, ThinkingWireStyle } from '../types/provider.js';
import { parseProviderHostname } from './providerHostname.js';

const REASONING_API_PARAMETERS = new Set([
  'reasoning',
  'include_reasoning',
  'reasoning_effort',
  'thinking'
]);

const EFFORT_ORDER: readonly ThinkingEffort[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh'
];

function capLeafSupported(node: unknown): boolean {
  return (
    !!node &&
    typeof node === 'object' &&
    (node as { supported?: boolean }).supported === true
  );
}

function orderedEfforts(levels: Iterable<ThinkingEffort>): ThinkingEffort[] {
  const set = new Set(levels);
  set.add('off');
  return EFFORT_ORDER.filter((e) => set.has(e));
}

/**
 * OpenAI `/v1/models` extended rows (`features`, `groups`) when the API
 * returns capability metadata (dashboard / future API shape, May 2026).
 */
export function thinkingFromOpenAiExtendedFields(model: {
  features?: string[];
  groups?: string[];
}): ModelThinkingCapabilities | undefined {
  const features = model.features ?? [];
  const groups = model.groups ?? [];
  const reasoning =
    features.includes('reasoning_effort') || groups.includes('reasoning');
  if (!reasoning) return undefined;
  return {
    supported: true,
    wireStyle: 'openai-reasoning',
    efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
  };
}

/** OpenAI-compatible `/v1/models` `supported_parameters` (OpenRouter, etc.). */
export function thinkingFromSupportedParameters(
  supportedParameters: string[] | undefined
): ModelThinkingCapabilities | undefined {
  if (!supportedParameters?.length) return undefined;
  const reasoning = supportedParameters.some((p) => REASONING_API_PARAMETERS.has(p));
  if (!reasoning) return undefined;
  const hasThinkingToggle = supportedParameters.includes('thinking');
  return {
    supported: true,
    wireStyle: hasThinkingToggle ? 'openai-deepseek' : 'openai-reasoning',
    efforts: hasThinkingToggle
      ? ['off', 'low', 'medium', 'high', 'xhigh']
      : ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultOn: hasThinkingToggle,
    rejectsToolChoice: hasThinkingToggle,
    mapsXhighToMax: hasThinkingToggle
  };
}

/** Anthropic `GET /v1/models` → `capabilities` object. */
export function thinkingFromAnthropicCapabilities(
  capabilities: unknown
): ModelThinkingCapabilities | undefined {
  if (!capabilities || typeof capabilities !== 'object') return undefined;
  const caps = capabilities as Record<string, unknown>;
  const thinking = caps.thinking;
  if (!capLeafSupported(thinking)) return undefined;

  const types =
    thinking && typeof thinking === 'object'
      ? (thinking as { types?: Record<string, unknown> }).types
      : undefined;
  const adaptive = types && capLeafSupported(types.adaptive);
  const enabled = types && capLeafSupported(types.enabled);
  const wireStyle: ThinkingWireStyle = adaptive
    ? 'anthropic-adaptive'
    : enabled
      ? 'anthropic-budget'
      : 'anthropic-adaptive';

  const effortNode = caps.effort;
  const efforts: ThinkingEffort[] = ['off'];
  if (effortNode && typeof effortNode === 'object') {
    const e = effortNode as Record<string, unknown>;
    if (capLeafSupported(e.minimal)) efforts.push('minimal');
    if (capLeafSupported(e.low)) efforts.push('low');
    if (capLeafSupported(e.medium)) efforts.push('medium');
    if (capLeafSupported(e.high)) efforts.push('high');
    if (capLeafSupported(e.xhigh)) efforts.push('xhigh');
    if (capLeafSupported(e.max)) efforts.push('xhigh');
  }
  if (efforts.length === 1) {
    efforts.push('low', 'medium', 'high', 'xhigh');
  }

  return {
    supported: true,
    wireStyle,
    efforts: orderedEfforts(efforts)
  };
}

/** Gemini `GET /v1beta/models` row (`thinking`, `version`). */
export function thinkingFromGeminiModel(model: {
  thinking?: boolean;
  version?: string;
}): ModelThinkingCapabilities | undefined {
  if (model.thinking !== true) return undefined;
  const version = (model.version ?? '').toLowerCase();
  const usesBudget =
    version.startsWith('2.5') || version.startsWith('2.0') || version.startsWith('2-5');
  return {
    supported: true,
    wireStyle: usesBudget ? 'gemini-budget' : 'gemini-level',
    efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultOn: usesBudget
  };
}

/** Ollama `POST /api/show` response (`capabilities`, optional `model_info`). */
export function thinkingFromOllamaShow(show: {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}): ModelThinkingCapabilities | undefined {
  const caps = show.capabilities;
  if (!Array.isArray(caps) || !caps.includes('thinking')) return undefined;

  const info = show.model_info;
  let family = '';
  if (info && typeof info === 'object') {
    const rec = info as {
      general?: { architecture?: string };
      family?: string;
    };
    family = String(rec.general?.architecture ?? rec.family ?? '').toLowerCase();
  }
  const usesLevels = family.includes('gpt-oss') || family.includes('gptoss');

  return {
    supported: true,
    wireStyle: usesLevels ? 'ollama-levels' : 'ollama-boolean',
    efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
  };
}

/**
 * DeepSeek's list API omits per-model metadata; the host speaks a single
 * OpenAI-compatible thinking protocol (2026 docs). Applied per discovered
 * chat model when the host is the official DeepSeek API.
 */
export function thinkingForDeepSeekApiModel(): ModelThinkingCapabilities {
  return {
    supported: true,
    wireStyle: 'openai-deepseek',
    efforts: ['off', 'low', 'medium', 'high', 'xhigh'],
    defaultOn: true,
    rejectsToolChoice: true,
    mapsXhighToMax: true
  };
}

/**
 * DeepSeek's list API omits per-model context; the host documents 1M
 * context for V4 models (2026). Applied per chat model on the official host.
 */
export function contextWindowForDeepSeekApiModel(): number {
  return 1_000_000;
}

/** Scan Ollama `model_info` for `*.context_length` dotted keys. */
export function contextWindowFromOllamaModelInfo(
  modelInfo: Record<string, unknown> | undefined
): number | undefined {
  if (!modelInfo || typeof modelInfo !== 'object') return undefined;
  const direct = (modelInfo as { context_length?: number }).context_length;
  if (typeof direct === 'number' && direct > 0) return direct;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (
      (key === 'context_length' || key.endsWith('.context_length')) &&
      typeof value === 'number' &&
      value > 0
    ) {
      return value;
    }
  }
  return undefined;
}

export function isDeepSeekApiHost(baseUrl: string): boolean {
  return parseProviderHostname(baseUrl).deepseek;
}

export function mergeThinkingCapabilities(
  ...candidates: Array<ModelThinkingCapabilities | undefined>
): ModelThinkingCapabilities | undefined {
  for (const c of candidates) {
    if (c?.supported) return c;
  }
  return undefined;
}

export function mergeContextWindows(
  ...candidates: Array<number | undefined>
): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && c > 0) return c;
  }
  return undefined;
}

export function positiveTokenCount(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return positiveTokenCount(parsed);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  return n > 0 ? n : undefined;
}

/**
 * OpenAI-compatible `/v1/models` row → context window in tokens.
 * Covers OpenRouter, vLLM, LM Studio shims, and gateway extensions.
 */
export function contextWindowFromOpenAiModelRow(row: {
  context_window?: unknown;
  context_length?: unknown;
  max_model_len?: unknown;
  max_input_tokens?: unknown;
  inputTokenLimit?: unknown;
  max_context_length?: unknown;
  top_provider?: { context_length?: unknown };
  meta?: { context_size?: unknown; n_ctx_train?: unknown; context_length?: unknown };
}): number | undefined {
  return mergeContextWindows(
    positiveTokenCount(row.context_window),
    positiveTokenCount(row.context_length),
    positiveTokenCount(row.top_provider?.context_length),
    positiveTokenCount(row.max_model_len),
    positiveTokenCount(row.max_input_tokens),
    positiveTokenCount(row.inputTokenLimit),
    positiveTokenCount(row.max_context_length),
    positiveTokenCount(row.meta?.context_size),
    positiveTokenCount(row.meta?.n_ctx_train),
    positiveTokenCount(row.meta?.context_length)
  );
}
