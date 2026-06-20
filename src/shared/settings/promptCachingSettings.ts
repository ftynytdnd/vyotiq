/**
 * Resolved defaults for `settings.ui.promptCaching`.
 */

import type { AppSettings } from '../types/ipc.js';

export type AnthropicCacheTtl = '5m' | '1h';

export interface PromptCachingSettings {
  /** Anthropic cache-diagnostics beta (`cache-diagnosis-2026-04-07`). */
  anthropicCacheDiagnostics: boolean;
  /** Anthropic `cache_control` TTL — 1h keeps long agent sessions warm (2× write surcharge). */
  anthropicCacheTtl: AnthropicCacheTtl;
  /** Opt-in Gemini explicit `cachedContents` for large static prefixes. */
  geminiExplicitCache: boolean;
  /** Send `prompt_cache_retention: 24h` for GPT-5/o3/o4 on the direct OpenAI host. */
  openaiExtendedCacheRetention: boolean;
}

export const DEFAULT_PROMPT_CACHING_SETTINGS: PromptCachingSettings = {
  anthropicCacheDiagnostics: false,
  anthropicCacheTtl: '1h',
  geminiExplicitCache: false,
  openaiExtendedCacheRetention: true
} as const;

export type ResolvedPromptCachingSettings = PromptCachingSettings;

export function resolvePromptCachingSettings(
  ui?: AppSettings['ui']
): ResolvedPromptCachingSettings {
  const p = ui?.promptCaching;
  const ttl = p?.anthropicCacheTtl;
  return {
    anthropicCacheDiagnostics: p?.anthropicCacheDiagnostics === true,
    anthropicCacheTtl: ttl === '5m' ? '5m' : DEFAULT_PROMPT_CACHING_SETTINGS.anthropicCacheTtl,
    geminiExplicitCache: p?.geminiExplicitCache === true,
    openaiExtendedCacheRetention: p?.openaiExtendedCacheRetention !== false
  };
}
