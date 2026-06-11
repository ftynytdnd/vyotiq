/**
 * Anthropic cache diagnostics beta (2026-04-07).
 * @see https://platform.claude.com/docs/en/build-with-claude/cache-diagnostics
 */

import { getPromptCachingSettings } from '../../settings/promptCachingRuntime.js';

export const ANTHROPIC_CACHE_DIAGNOSIS_BETA = 'cache-diagnosis-2026-04-07';

/** Enabled via settings, `VYOTIQ_CACHE_DIAGNOSTICS=1`, or `VYOTIQ_LOG_LEVEL=debug`. */
export function isAnthropicCacheDiagnosticsEnabled(): boolean {
  const flag = process.env['VYOTIQ_CACHE_DIAGNOSTICS'];
  if (flag === '1' || flag === 'true') return true;
  if (process.env['VYOTIQ_LOG_LEVEL'] === 'debug') return true;
  return getPromptCachingSettings().anthropicCacheDiagnostics;
}

export interface AnthropicCacheDiagnostics {
  /** `null` = comparison pending or no divergence; string = miss reason type. */
  cacheMissReason: string | null;
}

export function parseAnthropicCacheDiagnostics(raw: unknown): AnthropicCacheDiagnostics | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== 'object') return undefined;
  const block = raw as Record<string, unknown>;
  const reason = block['cache_miss_reason'];
  if (reason === null) return { cacheMissReason: null };
  if (reason && typeof reason === 'object') {
    const type = (reason as Record<string, unknown>)['type'];
    if (typeof type === 'string' && type.length > 0) {
      return { cacheMissReason: type };
    }
  }
  return undefined;
}
