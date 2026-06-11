/**
 * In-memory prompt-caching flags synced from persisted settings.
 * Env vars remain as dev overrides when settings are off.
 */

import {
  resolvePromptCachingSettings,
  type ResolvedPromptCachingSettings
} from '@shared/settings/promptCachingSettings.js';
import type { AppSettings } from '@shared/types/ipc.js';
import type {
  GeminiExplicitCacheStatus,
  PromptCacheRuntimeStatus
} from '@shared/types/promptCache.js';

export type { GeminiExplicitCacheStatus, PromptCacheRuntimeStatus };

let runtime: ResolvedPromptCachingSettings = resolvePromptCachingSettings();

let geminiExplicitCacheStatus: GeminiExplicitCacheStatus = { state: 'disabled' };

function geminiExplicitCacheEnvEnabled(): boolean {
  const flag = process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];
  return flag === '1' || flag === 'true';
}

export function syncPromptCachingFromSettings(settings: AppSettings): void {
  runtime = resolvePromptCachingSettings(settings.ui);
  if (!runtime.geminiExplicitCache && !geminiExplicitCacheEnvEnabled()) {
    geminiExplicitCacheStatus = { state: 'disabled' };
  }
}

export function getPromptCachingSettings(): ResolvedPromptCachingSettings {
  return runtime;
}

export function setGeminiExplicitCacheStatus(status: GeminiExplicitCacheStatus): void {
  geminiExplicitCacheStatus = status;
}

export function getGeminiExplicitCacheStatus(): GeminiExplicitCacheStatus {
  return geminiExplicitCacheStatus;
}

export function getPromptCacheRuntimeStatus(): PromptCacheRuntimeStatus {
  return { geminiExplicitCache: geminiExplicitCacheStatus };
}
