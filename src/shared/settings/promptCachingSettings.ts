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
  /** Force Gemini explicit `cachedContents` (also auto-enables when static prefix is large). */
  geminiExplicitCache: boolean;
}

export const DEFAULT_PROMPT_CACHING_SETTINGS: PromptCachingSettings = {
  anthropicCacheDiagnostics: false,
  anthropicCacheTtl: '1h',
  geminiExplicitCache: false
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
    geminiExplicitCache: p?.geminiExplicitCache === true
  };
}
